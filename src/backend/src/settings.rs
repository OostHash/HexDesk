//! The settings commands. The store itself, its defaults and its typed keys
//! live in `src/backend/crates/persist/src/settings.rs`.

use tauri::{Emitter, State};

use crate::app_state::AppState;
use crate::events;

#[tauri::command]
pub(crate) fn load_settings(state: State<AppState>) -> String {
    std::fs::read_to_string(state.settings.path()).unwrap_or_default()
}

/// Merges the frontend's partial settings over the file, so keys it does not
/// send (window geometry, backend keys) stay.
#[tauri::command]
pub(crate) fn save_settings(
    app: tauri::AppHandle,
    state: State<AppState>,
    json: String,
) -> Result<(), String> {
    let serde_json::Value::Object(new_map) =
        serde_json::from_str(&json).map_err(|e| e.to_string())?
    else {
        return Err("settings must be a JSON object".to_string());
    };
    state.settings.merge(|existing| {
        for (k, v) in new_map {
            existing.insert(k, v);
        }
    })?;
    app.emit(events::SETTINGS_UPDATED, ()).ok();
    Ok(())
}
