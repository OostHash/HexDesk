//! Keeps HexDesk to one running instance per user session.
//!
//! Two instances would each run overlays, the keyboard hook and the log
//! watchers, and write to the same settings and database.

use std::sync::OnceLock;

use hexdesk_diag::{info, warn};
use hexdesk_platform::single_instance::{self, Instance, Start};
use tauri::{AppHandle, Manager};

/// Debug builds use their own key, so `pnpm desktop:dev` runs next to the
/// installed app.
const KEY: &str = if cfg!(debug_assertions) {
    "com.oosthash.hexdesk.dev"
} else {
    "com.oosthash.hexdesk"
};

/// The claim of this process, or why it could not be made. Kept for the whole
/// run: dropping the claim would let a second instance start.
static CLAIM: OnceLock<Result<Instance, String>> = OnceLock::new();

/// Claims the instance key. Returns false when another instance is running;
/// it has been asked to show its window, and this process should exit.
///
/// Runs before logging starts, so a failed check is kept and logged by
/// [`listen`]. HexDesk then starts without the check rather than not at all.
pub(crate) fn claim() -> bool {
    let claim = match single_instance::start(KEY) {
        Ok(Start::AlreadyRunning) => return false,
        Ok(Start::First(instance)) => Ok(instance),
        Err(error) => Err(error.to_string()),
    };
    let _ = CLAIM.set(claim);
    true
}

/// Brings the main window to the front each time another start is handed
/// over to this instance. Call once logging runs.
pub(crate) fn listen(app: &AppHandle) {
    match CLAIM.get() {
        Some(Ok(instance)) => {
            let app = app.clone();
            if let Err(error) = instance.on_second_start(move || show_main_window(&app)) {
                warn!(app, error = %error, "Single-instance listener could not start; a second start will not show this window");
            }
        }
        Some(Err(error)) => {
            warn!(app, error = %error, "Single-instance check failed; this instance runs without it");
        }
        None => {}
    }
}

/// Gives up the claim, so the app started by a restart can claim it before
/// this process has exited.
pub(crate) fn release() {
    if let Some(Ok(instance)) = CLAIM.get() {
        instance.release();
    }
}

fn show_main_window(app: &AppHandle) {
    info!(app, "Another start was handed over to this instance");
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}
