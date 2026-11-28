//! Leaving the app: factory reset and the hard exit used by the close
//! handler.

use tauri::State;

use crate::app_state::AppState;
use crate::paths;

/// Wipes all user data and restarts the app into a clean state.
///
/// The DB files cannot be deleted while the current process holds them open,
/// so we write a marker to %TEMP% and finish the deletion on the next launch
/// (before a new connection is opened).  Everything else is deleted immediately.
#[tauri::command]
pub(crate) async fn factory_reset(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // Delete WFM credential silently (ignore errors — may not exist)
    {
        use hexdesk_platform::{CredentialStore, Platform};
        let _ = Platform::delete_credentials("HexDesk_WFM");
    }

    let config_dir = paths::config_dir();
    let data_dir = paths::data_dir();
    let cache_dir = paths::cache_dir();

    // These folders can contain screenshots or diagnostic history. Remove
    // them through their owners so no in-flight capture or open log file can
    // recreate old data during the reset.
    crate::captures::remove_all()?;
    crate::overlays::remove_testing_data()?;
    crate::logging::clear()?;

    // Delete user-editable config files.
    for name in &["settings.json", "corrections.json"] {
        let _ = std::fs::remove_file(config_dir.join(name));
    }
    // Delete user state that isn't the DB.
    let _ = std::fs::remove_file(data_dir.join("auction_ids.json"));
    // Wipe the entire cache tree — everything in it refetches on next launch.
    let _ = std::fs::remove_dir_all(&cache_dir);

    // Ask the next launch to delete the DB once it can (before opening a connection).
    let marker = paths::factory_reset_marker();
    std::fs::write(&marker, b"").map_err(|e| e.to_string())?;

    app.restart();
}

/// Hard-exit the process. Called from the frontend close handler when destroy()
/// is unreliable (e.g. after a Promise.race timeout on a hanging WFM API call).
#[tauri::command]
pub(crate) fn force_quit() {
    // `exit` skips destructors, so write the log out first.
    crate::logging::shutdown();
    std::process::exit(0);
}
