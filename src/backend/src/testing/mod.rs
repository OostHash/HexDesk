//! Opt-in screen-reading tests: the feedback rules of
//! `src/backend/crates/overlays/src/feedback.rs` wired to the disk, the
//! prompt window, notifications and the log.
//!
//! [`Testing`] lives on the overlay runtime thread. Screen reads on other
//! threads save their samples through [`capturing`] and the `save_*`
//! functions.

mod store;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use hexdesk_overlays::feedback::{Config, DiscardReason, Prompting};
use hexdesk_overlays::{Feedback, Notice, Screen, VisitId};
use hexdesk_persist::Snapshot;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

use crate::events;

pub(crate) use store::{capturing, remove_all_files, save_json, save_overlay, save_read};

/// How long an unanswered prompt stays up.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(15);

/// Read by the keyboard hook, which must not wait for the runtime thread.
static PROMPT_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Whether the keyboard hook should take Page Up and Page Down.
pub(crate) fn prompt_visible() -> bool {
    PROMPT_VISIBLE.load(Ordering::SeqCst)
}

/// The testing choices stored in `settings`.
pub(crate) fn config(settings: &Snapshot) -> Config {
    let prompting = match settings.feedback_frequency().every_n_flows() {
        Some(n) => Prompting::EveryNFlows(n),
        None => Prompting::OncePerRun,
    };
    Config {
        enabled: settings.testing_enabled(),
        prompting,
    }
}

/// Whether a settings write changed the testing choices.
pub(crate) fn config_changed(changes: &hexdesk_persist::Changes) -> bool {
    use hexdesk_persist::settings::keys;
    changes.contains(keys::TESTING_ENABLED) || changes.contains(keys::FEEDBACK_FREQUENCY)
}

pub(crate) struct Testing {
    app: tauri::AppHandle,
    feedback: Feedback<store::FsStore>,
}

impl Testing {
    pub(crate) fn new(app: tauri::AppHandle, config: Config) -> Testing {
        // Run ids only need to differ from reports an earlier session may
        // have left on disk.
        let first_run = chrono::Utc::now().timestamp_millis().max(1) as u64;
        Testing {
            app,
            feedback: Feedback::new(store::FsStore::new(), config, first_run),
        }
    }

    pub(crate) fn set_config(&mut self, config: Config) {
        let notices = self.feedback.set_config(config);
        self.show(notices);
    }

    pub(crate) fn enter(&mut self, visit: VisitId, screen: Screen) {
        let notices = self.feedback.enter(visit, screen);
        self.show(notices);
    }

    pub(crate) fn reclassify(&mut self, visit: VisitId, screen: Screen) {
        self.feedback.reclassify(visit, screen);
    }

    pub(crate) fn leave(&mut self, visit: VisitId, screen: Screen) {
        let notices = self.feedback.leave(visit, screen);
        self.show(notices);
    }

    pub(crate) fn answer(&mut self, correct: bool) {
        let notices = self.feedback.answer(correct);
        self.show(notices);
    }

    pub(crate) fn dismiss(&mut self) {
        let notices = self.feedback.dismiss();
        self.show(notices);
    }

    pub(crate) fn prompt_timeout(&mut self, flow: u64) {
        let notices = self.feedback.prompt_timeout(flow);
        self.show(notices);
    }

    pub(crate) fn run_ended(&mut self, at: i64) {
        let notices = self.feedback.run_ended(at);
        self.show(notices);
    }

    pub(crate) fn inventory_updated(&mut self, at: i64) {
        let notices = self.feedback.inventory_updated(at);
        self.show(notices);
    }

    pub(crate) fn remove_all(&mut self) -> Result<(), String> {
        let notices = self.feedback.remove_all()?;
        self.show(notices);
        Ok(())
    }

    fn show(&self, notices: Vec<Notice>) {
        for notice in notices {
            self.show_one(notice);
        }
    }

    fn show_one(&self, notice: Notice) {
        match notice {
            Notice::FlowCompleted(flow) => hexdesk_diag::debug!(
                overlay,
                flow = flow.id,
                kind = flow.kind.name(),
                visits = ?flow.visits,
                "Testing flow completed"
            ),
            Notice::PromptShown { flow, kind } => {
                PROMPT_VISIBLE.store(true, Ordering::SeqCst);
                let _ = self.app.emit(
                    events::TESTING_FEEDBACK,
                    serde_json::json!({ "visible": true, "flow": kind.name() }),
                );
                if let Err(reason) = crate::overlays::window::show_testing_feedback(&self.app) {
                    hexdesk_diag::info!(overlay, flow, reason = %reason, "Testing prompt could not be shown");
                }
                std::thread::spawn(move || {
                    std::thread::sleep(PROMPT_TIMEOUT);
                    crate::overlays::send(crate::overlays::Input::TestingPromptTimeout(flow));
                });
            }
            Notice::PromptHidden => {
                PROMPT_VISIBLE.store(false, Ordering::SeqCst);
                let _ = self.app.emit(
                    events::TESTING_FEEDBACK,
                    serde_json::json!({ "visible": false }),
                );
            }
            Notice::Discarded {
                flow,
                reason: DiscardReason::Correct,
            } => hexdesk_diag::debug!(overlay, flow, "Testing flow marked correct and discarded"),
            Notice::Discarded {
                flow,
                reason: DiscardReason::Ignored,
            } => hexdesk_diag::debug!(overlay, flow, "Testing prompt ignored and discarded"),
            Notice::Reported { flow, run } => {
                hexdesk_diag::info!(overlay, flow, run, "Testing flow reported");
            }
            Notice::ReportFailed { flow, error } => {
                let _ = self.app.emit(
                    events::TEST_REPORT,
                    serde_json::json!({ "path": null, "error": error }),
                );
                hexdesk_diag::info!(
                    overlay,
                    flow,
                    reason = %error,
                    "Testing flow could not be stored; its samples were discarded"
                );
            }
            Notice::RunExported { run, path, reports } => {
                let path_text = path.to_string_lossy().into_owned();
                let _ = self.app.emit(
                    events::TEST_REPORT,
                    serde_json::json!({ "path": path_text, "error": null }),
                );
                let _ = self
                    .app
                    .notification()
                    .builder()
                    .title("HexDesk test report saved")
                    .body(&path_text)
                    .show();
                hexdesk_diag::info!(
                    overlay,
                    run,
                    path = %path.display(),
                    reports,
                    "Testing report saved"
                );
            }
            Notice::RunExportFailed { run, error } => {
                let _ = self.app.emit(
                    events::TEST_REPORT,
                    serde_json::json!({ "path": null, "error": error }),
                );
                hexdesk_diag::info!(
                    overlay,
                    run,
                    reason = %error,
                    "Testing report could not be saved; reported samples were kept"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(json: serde_json::Value) -> Snapshot {
        let serde_json::Value::Object(map) = json else {
            panic!("settings are an object")
        };
        Snapshot::from(map)
    }

    #[test]
    fn settings_map_to_feedback_config() {
        assert_eq!(config(&snapshot(serde_json::json!({}))), Config::OFF);
        let once = config(&snapshot(serde_json::json!({
            "testingEnabled": true,
            "feedbackFrequency": "once-per-run",
        })));
        assert!(once.enabled);
        assert_eq!(once.prompting, Prompting::OncePerRun);
        let every_5 = config(&snapshot(serde_json::json!({
            "feedbackFrequency": "every-5-flows",
        })));
        assert_eq!(every_5.prompting, Prompting::EveryNFlows(5));
    }
}
