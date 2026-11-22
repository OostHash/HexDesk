//! Reading the game screen: capture and OCR. What the reward cards say is
//! read in `src/backend/crates/overlays/src/read/reward/mod.rs`.

mod screen;

pub use screen::*;

use std::sync::atomic::{AtomicBool, Ordering};

use hexdesk_capture::Provider;
use tauri::{Emitter, State};

use crate::app_state::AppState;
use crate::events;

/// Whether the player allowed the ocrs models: then ocrs reads what Windows
/// OCR could not.
static MODELS_ALLOWED: AtomicBool = AtomicBool::new(false);

/// Whether ocrs may read what Windows OCR could not: the player allowed the
/// models and they are on disk. A model download never starts in the middle
/// of a read.
pub(crate) fn ocrs_fallback() -> bool {
    MODELS_ALLOWED.load(Ordering::Acquire) && hexdesk_capture::provider_ready(Provider::Ocrs)
}

/// Applies the `ocrModels` setting at startup.
pub(crate) fn load_models_setting(map: &serde_json::Map<String, serde_json::Value>) {
    MODELS_ALLOWED.store(models_allowed(map), Ordering::Release);
}

/// Allows or stops the ocrs models. Allowing downloads them first, so a
/// failed download leaves the setting off.
#[tauri::command]
pub(crate) async fn set_ocr_models(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        tokio::task::spawn_blocking(|| hexdesk_capture::prepare_provider(Provider::Ocrs))
            .await
            .map_err(|e| format!("prepare the OCR models: {e}"))??;
    }
    state.settings.merge(|map| {
        map.insert("ocrModels".to_string(), serde_json::Value::Bool(enabled));
    })?;
    MODELS_ALLOWED.store(enabled, Ordering::Release);
    app.emit(events::SETTINGS_UPDATED, ()).ok();
    Ok(())
}

/// The `ocrModels` setting. A settings file without it allows the models
/// when it chose ocrs as an OCR engine (`ocrEngine`, `ocrEngines`): those
/// models are on disk already.
fn models_allowed(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    if let Some(allowed) = map.get("ocrModels").and_then(|v| v.as_bool()) {
        return allowed;
    }
    let ocrs = |value: &serde_json::Value| value.as_str() == Some("ocrs");
    map.get("ocrEngine").is_some_and(ocrs)
        || map
            .get("ocrEngines")
            .and_then(|v| v.as_object())
            .is_some_and(|engines| engines.values().any(ocrs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allowed(value: serde_json::Value) -> bool {
        models_allowed(value.as_object().unwrap())
    }

    #[test]
    fn the_models_are_off_without_a_setting() {
        assert!(!allowed(json!({})));
    }

    #[test]
    fn the_setting_wins() {
        assert!(allowed(json!({ "ocrModels": true })));
        assert!(!allowed(json!({ "ocrModels": false, "ocrEngine": "ocrs" })));
    }

    #[test]
    fn an_earlier_choice_of_ocrs_allows_the_models() {
        assert!(allowed(json!({ "ocrEngine": "ocrs" })));
        assert!(allowed(
            json!({ "ocrEngines": { "title": "windows", "riven": "ocrs" } })
        ));
        assert!(!allowed(json!({ "ocrEngine": "windows" })));
    }
}
