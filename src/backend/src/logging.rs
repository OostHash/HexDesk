//! Starts logging for the app. The subscriber, the log files and their
//! retention live in `src/backend/crates/logging`.

pub(crate) use hexdesk_logging::{clear, set_retention, shutdown};

/// Starts logging, keeping `retention_days` of daily logs.
pub(crate) fn init(retention_days: u64) {
    // Logs live in the state folder with the rest of the app's files, not in
    // the Tauri log dir.
    let log_dir = crate::paths::state_dir().join("logs");
    let started = hexdesk_logging::init(hexdesk_logging::Options {
        dir: log_dir.clone(),
        retention_days,
        file_filter: "warn,hexdesk=debug,hexdesk_backend=debug",
        console_filter: "info,hexdesk=info,hexdesk_backend=info",
    });
    if let Err(error) = started {
        // No subscriber is installed, so stderr is the only place left.
        eprintln!("HexDesk logging could not start: {error}");
        return;
    }
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        pid = std::process::id(),
        os = std::env::consts::OS,
        log_dir = %log_dir.display(),
        "HexDesk starting"
    );
}
