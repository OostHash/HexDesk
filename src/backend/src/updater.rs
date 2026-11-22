use hexdesk_diag::{info, DiagError, Kind, Source};
use tauri_plugin_updater::UpdaterExt;

/// The error for a failed updater step, with the plugin's error as the cause.
fn update_error(what: &'static str, kind: Kind, e: tauri_plugin_updater::Error) -> DiagError {
    DiagError::new(Source::Updater, kind, what)
        .caused_by(&e)
        .log()
}

/// Checks the release endpoint. Returns the new version, or `None` when this
/// is the latest.
#[tauri::command]
pub(crate) async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, DiagError> {
    let current = app.package_info().version.to_string();
    info!(updater, current = %current, "Checking for an update");
    let updater = app.updater_builder().build().map_err(|e| {
        update_error(
            "Update check failed: the updater could not be set up",
            Kind::Internal,
            e,
        )
    })?;
    match updater
        .check()
        .await
        .map_err(|e| update_error("Update check failed", Kind::Network, e))?
    {
        Some(update) => {
            info!(updater, current = %current, available = %update.version, "Update available");
            Ok(Some(update.version))
        }
        None => {
            info!(updater, current = %current, "No update available");
            Ok(None)
        }
    }
}

/// Downloads and installs the available update, then restarts the app.
#[tauri::command]
pub(crate) async fn install_update(app: tauri::AppHandle) -> Result<(), DiagError> {
    let updater = app.updater_builder().build().map_err(|e| {
        update_error(
            "Update install failed: the updater could not be set up",
            Kind::Internal,
            e,
        )
    })?;
    let Some(update) = updater.check().await.map_err(|e| {
        update_error(
            "Update install failed: the update check did not complete",
            Kind::Network,
            e,
        )
    })?
    else {
        info!(updater, "Update install skipped: no update available");
        return Ok(());
    };
    info!(updater, version = %update.version, "Downloading update");
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            |chunk, _total| downloaded += chunk as u64,
            || info!(updater, "Update downloaded, installing"),
        )
        .await
        .map_err(|e| update_error("Update install failed", Kind::Unavailable, e))?;
    info!(updater, bytes = downloaded, "Update installed, restarting");
    hexdesk_diag::flush();
    app.restart();
}
