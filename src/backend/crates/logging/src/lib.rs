//! HexDesk logging: the global subscriber and the daily log files.
//!
//! Every `tracing` event goes through `hexdesk-diag`, which writes the log
//! file and keeps recent entries in memory for the activity console and the
//! diagnostics export. This crate installs that route, owns the files it
//! writes to, and keeps a coloured console log for development.
//!
//! The log files are daily (`hexdesk.YYYY-MM-DD.log`). How many days are kept
//! is passed in by the caller; this crate never reads settings.

mod files;

use std::path::PathBuf;
use std::sync::Mutex;

use tracing_subscriber::{
    fmt,
    layer::{Layer, SubscriberExt},
    util::SubscriberInitExt,
    EnvFilter,
};

use files::LogFiles;

/// The open log files. One lock serializes every reopen (retention changes
/// and Remove logs arrive on different command threads) and shutdown.
static FILES: Mutex<Option<LogFiles>> = Mutex::new(None);

/// What [`init`] sets up.
pub struct Options {
    /// The folder the daily log files are written to.
    pub dir: PathBuf,
    /// Days of logs to keep; at least one.
    pub retention_days: u64,
    /// `EnvFilter` directives for the log file, used unless `RUST_LOG` is set.
    pub file_filter: &'static str,
    /// `EnvFilter` directives for the console, used unless `RUST_LOG` is set.
    pub console_filter: &'static str,
}

/// Installs the global subscriber, the `log`-crate bridge and a panic hook
/// that logs the panic before the process ends. Safe to call more than once;
/// later calls do nothing.
pub fn init(options: Options) -> Result<(), String> {
    let mut slot = FILES.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_some() || hexdesk_diag::collector().is_some() {
        return Ok(());
    }

    let (files, writer) = LogFiles::open(options.dir, options.retention_days)?;
    *slot = Some(files);
    drop(slot);

    // Windows paths carry the account name; show them as %USERPROFILE%.
    if let Some(home) = dirs::home_dir() {
        let home = home.to_string_lossy();
        hexdesk_diag::redact::register_replacement(&home, "%USERPROFILE%");
        hexdesk_diag::redact::register_replacement(&home.replace('\\', "/"), "%USERPROFILE%");
    }

    let collector = hexdesk_diag::Collector::new(hexdesk_diag::Config::default()).with_sink(writer);
    let diag_layer = hexdesk_diag::install(collector).with_filter(filter(options.file_filter));

    let console_layer = fmt::layer()
        .compact()
        .with_ansi(true)
        .with_target(true)
        .with_writer(std::io::stderr)
        .with_filter(filter(options.console_filter));

    let _ = tracing_subscriber::registry()
        .with(diag_layer)
        .with(console_layer)
        .try_init();

    let _ = tracing_log::LogTracer::init();

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("<non-string panic payload>");
        tracing::error!(
            location = %info.location().map_or_else(|| "unknown".to_string(), ToString::to_string),
            payload = message,
            "panic"
        );
        hexdesk_diag::flush();
        previous(info);
    }));
    Ok(())
}

/// Removes every log file and opens a fresh one for the active session, then
/// clears the activity console. Logging stays installed throughout. Returns
/// how many files were removed.
pub fn clear() -> Result<usize, String> {
    with_files(|files, collector| {
        let removed = files.reopen(collector, LogFiles::remove_all)?;
        collector.clear();
        Ok(removed)
    })
}

/// Keeps `days` of logs from now on and removes files already older than
/// that. The current file is reopened in append mode.
pub fn set_retention(days: u64) -> Result<(), String> {
    with_files(|files, collector| {
        files.set_retention(days);
        files.reopen(collector, |files| {
            files.prune(std::time::SystemTime::now());
            Ok(())
        })
    })
}

/// Writes pending repeat counts and everything still buffered to the log
/// file. Call right before the process exits.
pub fn shutdown() {
    // Pending repeat counts first, so "HexDesk stopping" is the last line.
    hexdesk_diag::flush();
    tracing::info!("HexDesk stopping");
    hexdesk_diag::flush();
    let mut slot = FILES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(files) = slot.as_mut() {
        files.close();
    }
}

/// Runs `apply` on the open files. Before [`init`] there is nothing to apply
/// to, which is not an error.
fn with_files<T: Default>(
    apply: impl FnOnce(&mut LogFiles, &hexdesk_diag::Collector) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = FILES.lock().unwrap_or_else(|e| e.into_inner());
    let (Some(files), Some(collector)) = (slot.as_mut(), hexdesk_diag::collector()) else {
        return Ok(T::default());
    };
    apply(files, collector)
}

fn filter(default: &str) -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default))
}
