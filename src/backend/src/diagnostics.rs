//! Diagnostics at the Tauri boundary: the one-click export and the feed for
//! the activity console. Everything comes from `hexdesk-diag` and is
//! already redacted.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use hexdesk_diag::{info, Bundle, DiagError, Entry, Kind, Source};
use tauri::{Emitter, State};

use crate::app_state::AppState;

const FILE_PREFIX: &str = "hexdesk-diagnostics-";

const README: &str = "HexDesk diagnostics export

What is in this zip:
- system.json    HexDesk version and build, OS, architecture, whether HexDesk
                 runs as administrator, locale, WebView2 version, monitors,
                 installed Windows OCR languages, whether Warframe is running.
- settings.json  Your HexDesk settings.
- recent.jsonl   The most recent log entries of this session, one per line.
- logs/          The HexDesk log files of the last days.

Passwords, tokens, e-mail addresses and player names are replaced with
[redacted]. Your Windows user folder is shown as %USERPROFILE%.
";

/// The most recent log entries, oldest first: what the console shows when it
/// opens. New entries follow as `diag-entry` events.
#[tauri::command]
pub(crate) fn get_recent_logs(limit: Option<usize>) -> Vec<Entry> {
    hexdesk_diag::recent(limit.unwrap_or(usize::MAX))
}

/// Removes local diagnostic history, captures and pending test samples while
/// keeping logging active and leaving every setting unchanged.
#[tauri::command]
pub(crate) fn remove_logs() -> Result<(), String> {
    crate::captures::remove_all()?;
    crate::overlays::remove_testing_data()?;
    let files = crate::logging::clear()?;
    info!(app, files, "Diagnostic logs and captures removed");
    Ok(())
}

thread_local! {
    /// Set while an entry is being forwarded. Emitting can log in turn; those
    /// entries are not forwarded again, so forwarding never recurses.
    static FORWARDING: Cell<bool> = const { Cell::new(false) };
}

/// Sends every new log entry to the main window as a `diag-entry` event.
pub(crate) fn forward_entries_to(app: tauri::AppHandle) {
    let Some(collector) = hexdesk_diag::collector() else {
        return;
    };
    collector.set_listener(move |entry| {
        if FORWARDING.with(|f| f.replace(true)) {
            return;
        }
        // No window yet, or it closed: nothing to show the entry in.
        let _ = app.emit_to("main", crate::events::DIAG_ENTRY, entry);
        FORWARDING.with(|f| f.set(false));
    });
}

/// Debug output of earlier versions: folders under the cache directory and
/// files in the temporary folder. Some of it holds account snapshots, memory
/// dumps, screenshots and player names, so it is removed at startup.
const OLD_DEBUG_DIRS: &[&str] = &["Debugging"];
const OLD_DEBUG_FILES: &[&str] = &[
    "scan_log.txt",
    "inventory_changes.txt",
    "inventory_hints.json",
    "mod_hints.json",
];
const OLD_TEMP_DIRS: &[&str] = &["hexdesk/diagnostics"];
const OLD_TEMP_FILES: &[&str] = &[
    "hexdesk_overlay_session.txt",
    "hexdesk_riven_session.txt",
    "hexdesk_last_reward.txt",
    "hexdesk_reward_debug.txt",
    "hexdesk_mem_relic_debug.log",
    "hexdesk_capture_debug.bmp",
];

/// Removes the debug output earlier versions left behind and logs what went.
/// Only paths HexDesk itself created are touched.
pub(crate) fn remove_old_debug_files(cache_dir: &Path, temp_dir: &Path) {
    let targets = OLD_DEBUG_DIRS
        .iter()
        .map(|d| (cache_dir.join(d), true))
        .chain(OLD_DEBUG_FILES.iter().map(|f| (cache_dir.join(f), false)))
        .chain(OLD_TEMP_DIRS.iter().map(|d| (temp_dir.join(d), true)))
        .chain(OLD_TEMP_FILES.iter().map(|f| (temp_dir.join(f), false)));
    let mut removed = Vec::new();
    for (path, is_dir) in targets {
        if !path.exists() {
            continue;
        }
        let result = if is_dir {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match result {
            Ok(()) => removed.push(path.display().to_string()),
            Err(e) => {
                let _ = DiagError::new(
                    Source::App,
                    Kind::Io,
                    "Old debug output of an earlier version could not be removed",
                )
                .with("path", path.display())
                .caused_by(&e)
                .log();
            }
        }
    }
    if !removed.is_empty() {
        info!(
            app,
            count = removed.len(),
            removed = %removed.join(", "),
            "Removed debug output of an earlier version"
        );
    }
}

/// A line from an overlay window (App, relic overlay), so the overlay's own
/// view of a reward screen lands in the same log as the backend's.
#[tauri::command]
pub(crate) fn log_relic_fe(msg: String) {
    hexdesk_diag::debug!(overlay, window_message = %msg, "Overlay window reported");
}

/// Which parts go into the diagnostics zip. The user picks them before
/// exporting; a missing field counts as included.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ExportParts {
    /// `system.json`: app version, OS, monitors, locale, WebView2, OCR languages.
    system: bool,
    /// `settings.json`, the settings file as stored (secrets are redacted).
    settings: bool,
    /// `recent.jsonl`, the activity console entries.
    activity: bool,
    /// The log files under `logs/`.
    logs: bool,
}

impl Default for ExportParts {
    fn default() -> Self {
        Self {
            system: true,
            settings: true,
            activity: true,
            logs: true,
        }
    }
}

/// Creates the diagnostics zip with the chosen parts (all when `parts` is
/// absent) and returns its full path.
#[tauri::command]
pub(crate) async fn export_diagnostics(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    parts: Option<ExportParts>,
) -> Result<String, DiagError> {
    let parts = parts.unwrap_or_default();
    // Pending repeat counts belong in the exported logs.
    hexdesk_diag::flush();

    let dir = export_dir();
    std::fs::create_dir_all(&dir).map_err(|e| {
        DiagError::new(
            Source::App,
            Kind::Io,
            "Diagnostics export failed: the folder could not be created",
        )
        .with("path", dir.display())
        .caused_by(&e)
        .log()
    })?;
    let path = dir.join(format!(
        "{FILE_PREFIX}{}.zip",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    ));

    let mut bundle = Bundle::new();
    bundle.add_text("README.txt", README);
    if parts.system {
        let ocr_languages = tokio::task::spawn_blocking(crate::ocr::ocr_languages)
            .await
            .unwrap_or_default();
        bundle.add_json("system.json", system_facts(&app, ocr_languages));
    }
    if parts.settings {
        let settings = state
            .settings
            .read()
            .map(|snapshot| serde_json::Value::Object(snapshot.into_map()))
            .unwrap_or_else(|e| serde_json::json!({ "_error": e }));
        bundle.add_json("settings.json", settings);
    }
    if parts.activity {
        bundle.add_entries("recent.jsonl", &hexdesk_diag::recent(usize::MAX));
    }
    let mut skipped = 0usize;
    let logs = if parts.logs {
        log_files(&crate::paths::state_dir().join("logs"))
    } else {
        Vec::new()
    };
    for log in logs {
        let name = format!(
            "logs/{}",
            log.file_name().unwrap_or_default().to_string_lossy()
        );
        if bundle.add_log_file(&name, &log).is_err() {
            skipped += 1;
        }
    }

    let write_path = path.clone();
    let files = bundle.names().len();
    tokio::task::spawn_blocking(move || bundle.write_to(&write_path))
        .await
        .map_err(|e| {
            DiagError::new(
                Source::App,
                Kind::Internal,
                "Diagnostics export failed: its worker task stopped",
            )
            .caused_by(&e)
            .log()
        })?
        .map_err(DiagError::log)?;

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    info!(
        app,
        path = %path.display(),
        files,
        unreadable_logs = skipped,
        bytes,
        system = parts.system,
        settings = parts.settings,
        activity = parts.activity,
        logs = parts.logs,
        "Diagnostics exported"
    );
    Ok(path.to_string_lossy().into_owned())
}

/// Opens Explorer with the exported zip selected. Only accepts files this
/// export wrote.
#[tauri::command]
pub(crate) fn show_diagnostics_export(path: String) -> Result<(), DiagError> {
    let path = PathBuf::from(path);
    let is_export = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with(FILE_PREFIX) && n.ends_with(".zip"));
    if !is_export || !path.is_file() {
        return Err(DiagError::new(
            Source::App,
            Kind::Invalid,
            "Not a HexDesk diagnostics export",
        )
        .with("path", path.display())
        .log());
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| {
        DiagError::new(
            Source::App,
            Kind::Internal,
            "The export folder could not be opened",
        )
        .caused_by(&e)
        .log()
    })
}

/// The Downloads folder, or the app's own diagnostics folder when Windows
/// reports none.
fn export_dir() -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| crate::paths::state_dir().join("diagnostics"))
}

/// The HexDesk log files in `dir`, oldest first.
fn log_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("hexdesk") && n.ends_with(".log"))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

fn system_facts(app: &tauri::AppHandle, ocr_languages: Vec<String>) -> serde_json::Value {
    let monitors: Vec<serde_json::Value> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            serde_json::json!({
                "width": m.size().width,
                "height": m.size().height,
                "x": m.position().x,
                "y": m.position().y,
                "scale": m.scale_factor(),
            })
        })
        .collect();
    serde_json::json!({
        "app_version": app.package_info().version.to_string(),
        "build": if cfg!(debug_assertions) { "debug" } else { "release" },
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "hexdesk_elevated": crate::memory_scanner::elevated_text(),
        "locale": crate::platform::get_system_locale(),
        "webview2": tauri::webview_version().ok(),
        "warframe_running": crate::memory_scanner::find_warframe_pid_pub().is_some(),
        "monitors": monitors,
        "ocr_languages": ocr_languages,
        "exported_at": chrono::Local::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_parts_left_out_of_the_request_are_included() {
        let parts: ExportParts = serde_json::from_str(r#"{"system":false,"logs":false}"#).unwrap();
        assert!(!parts.system && parts.settings && parts.activity && !parts.logs);
        let all = ExportParts::default();
        assert!(all.system && all.settings && all.activity && all.logs);
    }

    #[test]
    fn only_hexdesk_log_files_are_collected_in_order() {
        let dir = std::env::temp_dir().join(format!("hexdesk-logs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "hexdesk.2026-11-18.log",
            "hexdesk.2026-11-17.log",
            "other.log",
            "hexdesk.txt",
        ] {
            std::fs::write(dir.join(name), "x").unwrap();
        }
        let names: Vec<String> = log_files(&dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["hexdesk.2026-11-17.log", "hexdesk.2026-11-18.log"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn old_debug_output_is_removed_and_nothing_else() {
        let root = std::env::temp_dir().join(format!("hexdesk-old-debug-{}", std::process::id()));
        let cache = root.join("cache");
        let temp = root.join("temp");
        std::fs::create_dir_all(cache.join("Debugging").join("Inventory Snapshots")).unwrap();
        std::fs::write(cache.join("Debugging/Inventory Snapshots/blob.txt"), "x").unwrap();
        std::fs::write(cache.join("inventory_changes.txt"), "x").unwrap();
        std::fs::write(cache.join("items_cache.json"), "keep").unwrap();
        std::fs::create_dir_all(temp.join("hexdesk").join("diagnostics").join("run")).unwrap();
        std::fs::write(temp.join("hexdesk_overlay_session.txt"), "x").unwrap();
        std::fs::write(temp.join("hexdesk_factory_reset"), "keep").unwrap();

        remove_old_debug_files(&cache, &temp);

        assert!(!cache.join("Debugging").exists());
        assert!(!cache.join("inventory_changes.txt").exists());
        assert!(!temp.join("hexdesk").join("diagnostics").exists());
        assert!(!temp.join("hexdesk_overlay_session.txt").exists());
        assert!(cache.join("items_cache.json").exists());
        assert!(temp.join("hexdesk_factory_reset").exists());
        // A second start finds nothing to do.
        remove_old_debug_files(&cache, &temp);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn only_export_files_can_be_shown() {
        let err = show_diagnostics_export(r"C:\Windows\System32\cmd.exe".into()).unwrap_err();
        assert_eq!(err.code(), "app.invalid");
    }
}
