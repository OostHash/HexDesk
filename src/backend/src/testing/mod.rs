//! Opt-in screen-reading tests: the feedback rules of
//! `src/backend/crates/overlays/src/feedback.rs` wired to the disk, the
//! prompt window, notifications and the log.
//!
//! [`Testing`] lives on the overlay runtime thread. Screen reads on other
//! threads save their samples through [`capturing`] and the `save_*`
//! functions.

mod store;
mod thumbnail;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use hexdesk_overlays::feedback::{Config, DiscardReason, Prompting};
use hexdesk_overlays::{Feedback, Notice, Screen, VisitId};
use hexdesk_persist::Snapshot;
use tauri::Emitter;

use crate::events;

pub(crate) use store::{capturing, remove_all_files, save_json, save_overlay, save_read};

/// How long an unanswered prompt stays up.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(15);

/// Read by the keyboard hook, which must not wait for the runtime thread.
static PROMPT_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Read by the app header, which must not wait for the runtime thread.
static KEPT: AtomicUsize = AtomicUsize::new(0);

/// Whether the keyboard hook should take Page Up and Page Down.
pub(crate) fn prompt_visible() -> bool {
    PROMPT_VISIBLE.load(Ordering::SeqCst)
}

/// How many reported flows wait for an export.
pub(crate) fn kept() -> usize {
    KEPT.load(Ordering::SeqCst)
}

/// The testing choices stored in `settings`. Testing is off while a key to
/// answer the prompt is missing, since a prompt could not be answered.
pub(crate) fn config(settings: &Snapshot) -> Config {
    let prompting = match settings.feedback_frequency().every_n_flows() {
        Some(n) => Prompting::EveryNFlows(n),
        None => Prompting::OncePerRun,
    };
    Config {
        enabled: settings.testing_enabled() && settings.testing_keys_set(),
        prompting,
    }
}

/// Whether a settings write changed the testing choices.
pub(crate) fn config_changed(changes: &hexdesk_persist::Changes) -> bool {
    use hexdesk_persist::settings::keys;
    [
        keys::TESTING_ENABLED,
        keys::FEEDBACK_FREQUENCY,
        keys::TESTING_CORRECT_KEY,
        keys::TESTING_WRONG_KEY,
    ]
    .iter()
    .any(|key| changes.contains(key))
}

pub(crate) struct Testing {
    app: tauri::AppHandle,
    feedback: Feedback<store::FsStore>,
}

impl Testing {
    pub(crate) fn new(app: tauri::AppHandle, config: Config) -> Testing {
        // Run ids only need to differ from runs an earlier session may have
        // left on disk.
        let first_run = chrono::Utc::now().timestamp_millis().max(1) as u64;
        let testing = Testing {
            app,
            feedback: Feedback::new(store::FsStore::new(), config, first_run),
        };
        testing.publish_kept();
        testing
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

    pub(crate) fn run_ended(&mut self) {
        let notices = self.feedback.run_ended();
        self.show(notices);
    }

    /// Writes every reported flow into one zip and returns its path.
    pub(crate) fn export(&mut self) -> Result<String, String> {
        let result = self.feedback.export();
        self.publish_kept();
        match result {
            Ok(export) => {
                hexdesk_diag::info!(
                    overlay,
                    path = %export.path.display(),
                    flows = export.flows,
                    "Testing report saved"
                );
                Ok(export.path.to_string_lossy().into_owned())
            }
            Err(error) => {
                hexdesk_diag::info!(
                    overlay,
                    reason = %error,
                    "Testing report could not be saved; reported flows were kept"
                );
                Err(error)
            }
        }
    }

    /// Removes every reported flow without writing a report.
    pub(crate) fn discard_reports(&mut self) -> Result<(), String> {
        let flows = self.feedback.kept();
        let result = self.feedback.discard_reports();
        self.publish_kept();
        match &result {
            Ok(()) => hexdesk_diag::info!(overlay, flows, "Reported testing flows discarded"),
            Err(error) => hexdesk_diag::info!(
                overlay,
                reason = %error,
                "Reported testing flows could not be discarded"
            ),
        }
        result
    }

    pub(crate) fn remove_all(&mut self) -> Result<(), String> {
        let result = self.feedback.remove_all();
        self.publish_kept();
        self.show(result?);
        Ok(())
    }

    /// Confirms in the game what happened, so the player does not have to
    /// switch to HexDesk to know an answer or report was saved.
    fn confirm(&self, text: &str, success: bool) {
        let _ = self.app.emit(
            events::TESTING_NOTICE,
            serde_json::json!({ "text": text, "tone": if success { "success" } else { "danger" } }),
        );
        let _ = crate::overlays::window::show_overlay_status_window(self.app.clone());
    }

    fn show(&self, notices: Vec<Notice>) {
        for notice in notices {
            self.show_one(notice);
        }
    }

    /// Tells the app header how many reported flows wait for an export.
    fn publish_kept(&self) {
        let kept = self.feedback.kept();
        if KEPT.swap(kept, Ordering::SeqCst) != kept {
            let _ = self.app.emit(events::TEST_REPORT_FLOWS, kept);
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
                    serde_json::json!({
                        "visible": true,
                        "flow": kind.name(),
                        "timeoutMs": PROMPT_TIMEOUT.as_millis() as u64,
                    }),
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
            } => {
                self.confirm("Marked correct. Nothing was kept.", true);
                hexdesk_diag::debug!(overlay, flow, "Testing flow marked correct and discarded");
            }
            Notice::Discarded {
                flow,
                reason: DiscardReason::Ignored,
            } => hexdesk_diag::debug!(overlay, flow, "Testing prompt ignored and discarded"),
            Notice::Reported { flow, run } => {
                self.confirm(
                    "Kept for your test report. Export it from the HexDesk header.",
                    true,
                );
                self.publish_kept();
                hexdesk_diag::info!(overlay, flow, run, "Testing flow reported");
            }
            Notice::ReportFailed { flow, error } => {
                self.confirm(
                    "This flow could not be kept. See Settings → Console.",
                    false,
                );
                let _ = self
                    .app
                    .emit(events::TEST_REPORT, serde_json::json!({ "error": error }));
                hexdesk_diag::info!(
                    overlay,
                    flow,
                    reason = %error,
                    "Testing flow could not be stored; its samples were discarded"
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

    #[test]
    fn testing_stays_off_without_both_keys() {
        let without_wrong_key = config(&snapshot(serde_json::json!({
            "testingEnabled": true,
            "testingWrongKey": "off",
        })));
        assert!(!without_wrong_key.enabled);
        let with_chosen_keys = config(&snapshot(serde_json::json!({
            "testingEnabled": true,
            "testingCorrectKey": "F1",
            "testingWrongKey": "F2",
        })));
        assert!(with_chosen_keys.enabled);
    }
}
