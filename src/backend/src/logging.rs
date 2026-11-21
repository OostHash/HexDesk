//! Subscriber setup. Every `tracing` event goes through `hexdesk-diag`, which
//! writes the daily-rolling log file and keeps recent entries in memory for
//! the activity console and the diagnostics export. A coloured console log is
//! kept for development.

use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime},
};

use tracing_subscriber::{
    fmt,
    layer::{Layer, SubscriberExt},
    util::SubscriberInitExt,
    EnvFilter,
};

/// Dropping the `WorkerGuard` flushes the non-blocking writer's buffer, so it
/// has to outlive every log call; otherwise the last events (including a
/// panic) never reach disk. [`shutdown`] takes and drops it.
static FILE_GUARD: Mutex<Option<tracing_appender::non_blocking::WorkerGuard>> = Mutex::new(None);
/// Serializes reopening the same daily file (retention changes and Remove
/// logs can be invoked from different Tauri command threads).
static FILE_RELOAD_LOCK: Mutex<()> = Mutex::new(());

/// Installs the global subscriber, log-crate bridge and panic hook. Safe to
/// call more than once; later calls do nothing.
pub fn init() {
    let mut guard_slot = FILE_GUARD.lock().unwrap_or_else(|e| e.into_inner());
    if guard_slot.is_some() || hexdesk_diag::collector().is_some() {
        return;
    }

    // Logs live in the state folder with the rest of the app's files, not in
    // the Tauri log dir.
    let log_dir = crate::paths::state_dir().join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let retention_days =
        crate::settings::log_retention_days(&crate::paths::config_dir().join("settings.json"));
    prune_logs(&log_dir, retention_days, SystemTime::now());

    let (writer, guard) = file_writer(&log_dir, retention_days).expect("log dir was just created");
    *guard_slot = Some(guard);
    drop(guard_slot);

    // Windows paths carry the account name; show them as %USERPROFILE%.
    if let Some(home) = dirs::home_dir() {
        let home = home.to_string_lossy();
        hexdesk_diag::redact::register_replacement(&home, "%USERPROFILE%");
        hexdesk_diag::redact::register_replacement(&home.replace('\\', "/"), "%USERPROFILE%");
    }

    let collector = hexdesk_diag::Collector::new(hexdesk_diag::Config::default()).with_sink(writer);
    let diag_layer = hexdesk_diag::install(collector)
        .with_filter(filter("warn,hexdesk=debug,hexdesk_backend=debug"));

    let console_layer = fmt::layer()
        .compact()
        .with_ansi(true)
        .with_target(true)
        .with_writer(std::io::stderr)
        .with_filter(filter("info,hexdesk=info,hexdesk_backend=info"));

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

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        pid = std::process::id(),
        os = std::env::consts::OS,
        log_dir = %log_dir.display(),
        "HexDesk starting"
    );
}

/// Removes the existing daily logs and immediately opens a fresh log for the
/// active session. The installed subscriber and console listener stay alive.
pub fn clear_files() -> Result<usize, String> {
    let _reload = FILE_RELOAD_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    hexdesk_diag::flush();
    let collector = hexdesk_diag::collector().ok_or("diagnostic collector is not running")?;
    collector.take_sink();
    drop(
        FILE_GUARD
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take(),
    );

    let log_dir = crate::paths::state_dir().join("logs");
    let removal = remove_log_files(&log_dir);
    let retention_days =
        crate::settings::log_retention_days(&crate::paths::config_dir().join("settings.json"));
    let (writer, guard) = file_writer(&log_dir, retention_days)?;
    collector.set_sink(writer);
    *FILE_GUARD.lock().unwrap_or_else(|error| error.into_inner()) = Some(guard);
    let removed = removal?;
    collector.clear();
    Ok(removed)
}

/// Applies a changed retention setting to the active daily appender. The
/// current file is reopened in append mode; no history inside the new limit
/// is removed except files already older than that limit.
pub fn reload_retention() -> Result<(), String> {
    let _reload = FILE_RELOAD_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(collector) = hexdesk_diag::collector() else {
        return Ok(());
    };
    hexdesk_diag::flush();
    collector.take_sink();
    drop(
        FILE_GUARD
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take(),
    );

    let log_dir = crate::paths::state_dir().join("logs");
    let retention_days =
        crate::settings::log_retention_days(&crate::paths::config_dir().join("settings.json"));
    prune_logs(&log_dir, retention_days, SystemTime::now());
    let (writer, guard) = file_writer(&log_dir, retention_days)?;
    collector.set_sink(writer);
    *FILE_GUARD.lock().unwrap_or_else(|error| error.into_inner()) = Some(guard);
    Ok(())
}

/// Writes pending repeat counts and everything still buffered to the log
/// file. Call right before the process exits.
pub fn shutdown() {
    // Pending repeat counts first, so "HexDesk stopping" is the last line.
    hexdesk_diag::flush();
    tracing::info!("HexDesk stopping");
    hexdesk_diag::flush();
    let guard = FILE_GUARD.lock().unwrap_or_else(|e| e.into_inner()).take();
    drop(guard);
}

fn filter(default: &str) -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default))
}

fn file_writer(
    log_dir: &Path,
    retention_days: u64,
) -> Result<
    (
        tracing_appender::non_blocking::NonBlocking,
        tracing_appender::non_blocking::WorkerGuard,
    ),
    String,
> {
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("hexdesk")
        .filename_suffix("log")
        .max_log_files(retention_days as usize)
        .build(log_dir)
        .map_err(|error| error.to_string())?;
    // Non-blocking so the scanner and OCR hot loops never stall on disk I/O.
    Ok(tracing_appender::non_blocking(appender))
}

fn remove_log_files(dir: &Path) -> Result<usize, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_log = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("hexdesk.") && name.ends_with(".log"));
        if is_log {
            std::fs::remove_file(path).map_err(|error| error.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

fn prune_logs(dir: &Path, retention_days: u64, now: SystemTime) {
    let cutoff = now
        .checked_sub(Duration::from_secs(
            retention_days.saturating_mul(24 * 60 * 60),
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_log = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("hexdesk.") && name.ends_with(".log"));
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|modified| modified < cutoff);
        if is_log && old {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{prune_logs, remove_log_files};
    use std::time::{Duration, SystemTime};

    #[test]
    fn pruning_only_removes_expired_hexdesk_logs() {
        let dir = std::env::temp_dir().join(format!("hexdesk-log-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory is writable");
        let old_log = dir.join("hexdesk.old.log");
        let unrelated = dir.join("notes.log");
        std::fs::write(&old_log, "old").expect("scratch file is writable");
        std::fs::write(&unrelated, "keep").expect("scratch file is writable");
        let future = SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60);

        prune_logs(&dir, 1, future);

        assert!(!old_log.exists());
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn removing_logs_keeps_unrelated_files() {
        let dir = std::env::temp_dir().join(format!("hexdesk-log-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory is writable");
        let log = dir.join("hexdesk.2026-11-21.log");
        let unrelated = dir.join("notes.log");
        std::fs::write(&log, "remove").expect("scratch file is writable");
        std::fs::write(&unrelated, "keep").expect("scratch file is writable");

        assert_eq!(remove_log_files(&dir).expect("logs are removed"), 1);
        assert!(!log.exists());
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
