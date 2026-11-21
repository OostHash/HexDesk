//! Opt-in screen-reading test samples and per-run reports.
//!
//! Pending files are isolated by tracker visit. A completed logical flow is
//! discarded unless the cadence asks and the player presses Page Down. Only
//! reported flow folders are added to the run zip.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use hexdesk_overlays::{Flow, VisitId};
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

use crate::events;

static ACTIVE_VISITS: OnceLock<Mutex<HashSet<VisitId>>> = OnceLock::new();
static PROMPT_VISIBLE: AtomicBool = AtomicBool::new(false);
static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn active_visits() -> &'static Mutex<HashSet<VisitId>> {
    ACTIVE_VISITS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn root() -> PathBuf {
    crate::paths::state_dir().join("testing")
}

fn visit_dir(visit: VisitId) -> PathBuf {
    root().join("pending").join(format!("visit-{visit}"))
}

/// Whether the global keyboard hook should accept Page Up/Page Down.
pub(crate) fn prompt_visible() -> bool {
    PROMPT_VISIBLE.load(Ordering::SeqCst)
}

/// Stops every in-flight capture immediately. The runtime reset follows on
/// its own serialized channel.
pub(crate) fn clear_active() {
    active_visits()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    PROMPT_VISIBLE.store(false, Ordering::SeqCst);
}

/// Whether background work should save a sample for this visit.
pub(crate) fn capturing(visit: VisitId) -> bool {
    active_visits()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(&visit)
}

fn begin_visit(visit: VisitId) {
    active_visits()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(visit);
    let _ = std::fs::create_dir_all(visit_dir(visit));
}

fn stop_visit(visit: VisitId) {
    active_visits()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&visit);
}

fn sample_stem(prefix: &str) -> String {
    let sequence = FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "{prefix}-{}-{sequence}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")
    )
}

/// Saves pixels and their structured OCR result in the pending visit folder.
pub(crate) fn save_read(
    visit: VisitId,
    prefix: &str,
    bmp: &[u8],
    read: &hexdesk_capture::TextRead,
) {
    save_pair(visit, prefix, bmp, read.to_json().as_bytes());
}

/// Saves pixels and a caller-provided JSON OCR result.
pub(crate) fn save_json(visit: VisitId, prefix: &str, bmp: &[u8], json: &[u8]) {
    save_pair(visit, prefix, bmp, json);
}

fn save_pair(visit: VisitId, prefix: &str, bmp: &[u8], json: &[u8]) {
    if !capturing(visit) {
        return;
    }
    let dir = visit_dir(visit);
    let stem = sample_stem(prefix);
    let result = std::fs::create_dir_all(&dir)
        .and_then(|()| std::fs::write(dir.join(format!("{stem}.bmp")), bmp))
        .and_then(|()| std::fs::write(dir.join(format!("{stem}.json")), json));
    if let Err(error) = result {
        hexdesk_diag::debug!(
            overlay,
            visit,
            reason = %error,
            "Pending test sample could not be saved"
        );
    }
}

/// Saves the combined game-and-overlay image needed to review the flow.
pub(crate) fn save_overlay(visit: VisitId, prefix: &str, bmp: &[u8]) {
    if !capturing(visit) {
        return;
    }
    let dir = visit_dir(visit);
    let name = format!("{}.bmp", sample_stem(prefix));
    if let Err(error) =
        std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(dir.join(name), bmp))
    {
        hexdesk_diag::debug!(
            overlay,
            visit,
            reason = %error,
            "Pending overlay image could not be saved"
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Frequency {
    Every,
    EveryN(u64),
    OncePerRun,
}

fn frequency(value: Option<&str>) -> Frequency {
    match value {
        Some("every-3-flows") => Frequency::EveryN(3),
        Some("every-5-flows") => Frequency::EveryN(5),
        Some("once-per-run") => Frequency::OncePerRun,
        _ => Frequency::Every,
    }
}

#[derive(Debug, Default)]
struct Cadence {
    completed: u64,
    prompted_this_run: bool,
}

impl Cadence {
    fn completed(&mut self, frequency: Frequency) -> bool {
        self.completed += 1;
        let due = match frequency {
            Frequency::Every => true,
            Frequency::EveryN(n) => self.completed % n == 0,
            Frequency::OncePerRun => !self.prompted_this_run,
        };
        if due {
            self.prompted_this_run = true;
        }
        due
    }

    fn end_run(&mut self) {
        self.prompted_this_run = false;
    }
}

#[derive(Debug)]
struct PendingPrompt {
    flow: Flow,
}

/// State owned by the overlay runtime thread.
pub(crate) struct Runtime {
    settings_path: PathBuf,
    cadence: Cadence,
    prompt: Option<PendingPrompt>,
    run: u64,
    run_ended: bool,
    inventory_after_end: bool,
    latest_inventory_at: Option<i64>,
    reports: usize,
}

impl Runtime {
    pub(crate) fn new(settings_path: PathBuf) -> Self {
        // Pending means unanswered. A process restart counts as ignoring it.
        let pending = root().join("pending");
        if pending.exists() {
            let _ = std::fs::remove_dir_all(pending);
        }
        Self {
            settings_path,
            cadence: Cadence::default(),
            prompt: None,
            run: chrono::Utc::now().timestamp_millis().max(1) as u64,
            run_ended: false,
            inventory_after_end: false,
            latest_inventory_at: None,
            reports: 0,
        }
    }

    fn config(&self) -> (bool, Frequency) {
        let map = crate::settings::read_settings_map(&self.settings_path).unwrap_or_default();
        let enabled = map
            .get("testingEnabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let frequency = frequency(
            map.get("feedbackFrequency")
                .and_then(serde_json::Value::as_str),
        );
        (enabled, frequency)
    }

    pub(crate) fn visit_started(&mut self, app: &tauri::AppHandle, visit: VisitId) {
        // Starting another flow ignores any unanswered prompt and its sample.
        self.dismiss_prompt(app);
        if self.config().0 {
            begin_visit(visit);
        }
    }

    pub(crate) fn flow_completed(&mut self, app: &tauri::AppHandle, flow: Flow) {
        for visit in &flow.visits {
            stop_visit(*visit);
        }
        let (enabled, frequency) = self.config();
        if !enabled || !flow_has_samples(&flow) || !self.cadence.completed(frequency) {
            discard_flow(&flow);
            return;
        }
        self.dismiss_prompt(app);
        let flow_id = flow.id;
        let kind = flow.kind.name();
        self.prompt = Some(PendingPrompt { flow });
        PROMPT_VISIBLE.store(true, Ordering::SeqCst);
        let _ = app.emit(
            events::TESTING_FEEDBACK,
            serde_json::json!({ "visible": true, "flow": kind }),
        );
        let _ = crate::overlays::window::show_testing_feedback(app);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(15));
            crate::overlays::send(crate::overlays::Input::TestingPromptTimeout(flow_id));
        });
    }

    pub(crate) fn answer(&mut self, app: &tauri::AppHandle, correct: bool) {
        let Some(prompt) = self.prompt.take() else {
            return;
        };
        PROMPT_VISIBLE.store(false, Ordering::SeqCst);
        let _ = app.emit(
            events::TESTING_FEEDBACK,
            serde_json::json!({ "visible": false }),
        );
        if correct {
            discard_flow(&prompt.flow);
            hexdesk_diag::debug!(
                overlay,
                flow = prompt.flow.id,
                "Testing flow marked correct and discarded"
            );
        } else {
            match keep_flow(self.run, &prompt.flow) {
                Ok(()) => {
                    self.reports += 1;
                    hexdesk_diag::info!(
                        overlay,
                        flow = prompt.flow.id,
                        run = self.run,
                        "Testing flow reported"
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        events::TEST_REPORT,
                        serde_json::json!({ "path": null, "error": error }),
                    );
                    hexdesk_diag::info!(
                        overlay,
                        flow = prompt.flow.id,
                        reason = %error,
                        "Testing flow could not be stored; pending files were kept"
                    );
                }
            }
        }
        self.finish_run_if_ready(app);
    }

    pub(crate) fn dismiss_prompt(&mut self, app: &tauri::AppHandle) {
        let Some(prompt) = self.prompt.take() else {
            return;
        };
        discard_flow(&prompt.flow);
        PROMPT_VISIBLE.store(false, Ordering::SeqCst);
        let _ = app.emit(
            events::TESTING_FEEDBACK,
            serde_json::json!({ "visible": false }),
        );
        self.finish_run_if_ready(app);
    }

    pub(crate) fn prompt_timeout(&mut self, app: &tauri::AppHandle, flow: u64) {
        if self
            .prompt
            .as_ref()
            .is_some_and(|prompt| prompt.flow.id == flow)
        {
            self.dismiss_prompt(app);
            hexdesk_diag::debug!(overlay, flow, "Testing prompt ignored and discarded");
        }
    }

    pub(crate) fn run_ended(&mut self, app: &tauri::AppHandle, ended_at: i64) {
        self.run_ended = true;
        self.inventory_after_end = self
            .latest_inventory_at
            .is_some_and(|inventory_at| inventory_at >= ended_at);
        self.cadence.end_run();
        self.finish_run_if_ready(app);
    }

    pub(crate) fn inventory_updated(&mut self, app: &tauri::AppHandle, at: i64) {
        self.latest_inventory_at = Some(at);
        if !self.run_ended {
            return;
        }
        self.inventory_after_end = true;
        self.finish_run_if_ready(app);
    }

    pub(crate) fn data_removed(&mut self, app: &tauri::AppHandle) {
        self.prompt = None;
        self.reports = 0;
        clear_active();
        let _ = app.emit(
            events::TESTING_FEEDBACK,
            serde_json::json!({ "visible": false }),
        );
    }

    fn finish_run_if_ready(&mut self, app: &tauri::AppHandle) {
        if !self.run_ended || !self.inventory_after_end || self.prompt.is_some() {
            return;
        }
        if self.reports > 0 {
            match export_run(self.run) {
                Ok(path) => {
                    let path_text = path.to_string_lossy().into_owned();
                    let _ = app.emit(
                        events::TEST_REPORT,
                        serde_json::json!({ "path": path_text, "error": null }),
                    );
                    let _ = app
                        .notification()
                        .builder()
                        .title("HexDesk test report saved")
                        .body(path.to_string_lossy())
                        .show();
                    let _ = std::fs::remove_dir_all(run_dir(self.run));
                    hexdesk_diag::info!(
                        overlay,
                        run = self.run,
                        path = %path.display(),
                        reports = self.reports,
                        "Testing report saved"
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        events::TEST_REPORT,
                        serde_json::json!({ "path": null, "error": error }),
                    );
                    hexdesk_diag::info!(
                        overlay,
                        run = self.run,
                        reason = %error,
                        "Testing report could not be saved; reported samples were kept"
                    );
                }
            }
        }
        self.run += 1;
        self.run_ended = false;
        self.inventory_after_end = false;
        self.reports = 0;
    }
}

fn discard_flow(flow: &Flow) {
    for visit in &flow.visits {
        stop_visit(*visit);
        let path = visit_dir(*visit);
        if path.exists() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn flow_has_samples(flow: &Flow) -> bool {
    flow.visits.iter().any(|visit| {
        std::fs::read_dir(visit_dir(*visit))
            .ok()
            .is_some_and(|mut entries| entries.next().is_some())
    })
}

fn run_dir(run: u64) -> PathBuf {
    root().join("runs").join(format!("run-{run}"))
}

fn keep_flow(run: u64, flow: &Flow) -> Result<(), String> {
    let destination = run_dir(run).join(format!("flow-{}-{}", flow.id, flow.kind.name()));
    std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    std::fs::write(
        destination.join("flow.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "flow": flow.id,
            "kind": flow.kind.name(),
            "visits": flow.visits,
        }))
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    for visit in &flow.visits {
        stop_visit(*visit);
        let source = visit_dir(*visit);
        if source.exists() {
            std::fs::rename(&source, destination.join(format!("visit-{visit}")))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn export_run(run: u64) -> Result<PathBuf, String> {
    let source = run_dir(run);
    let output_dir = dirs::download_dir().unwrap_or_else(|| root().join("reports"));
    std::fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let output = output_dir.join(format!(
        "hexdesk-test-report-{}-run-{run}.zip",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    ));
    let mut bundle = hexdesk_diag::Bundle::new();
    bundle.add_text(
        "README.txt",
        "HexDesk opt-in screen-reading test report. This archive contains only flows marked wrong with Page Down. It is not uploaded automatically.\n",
    );
    add_tree(&mut bundle, &source, &source)?;
    bundle
        .write_to(&output)
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn add_tree(bundle: &mut hexdesk_diag::Bundle, root: &Path, dir: &Path) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            add_tree(bundle, root, &path)?;
        } else if path.is_file() {
            let name = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
            bundle.add_bytes(&name, bytes);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cadence_counts_completed_flows_and_a_shown_prompt_counts() {
        let mut cadence = Cadence::default();
        assert!(!cadence.completed(Frequency::EveryN(3)));
        assert!(!cadence.completed(Frequency::EveryN(3)));
        assert!(cadence.completed(Frequency::EveryN(3)));
        assert!(!cadence.completed(Frequency::EveryN(3)));
    }

    #[test]
    fn once_per_run_resets_only_at_run_end() {
        let mut cadence = Cadence::default();
        assert!(cadence.completed(Frequency::OncePerRun));
        assert!(!cadence.completed(Frequency::OncePerRun));
        cadence.end_run();
        assert!(cadence.completed(Frequency::OncePerRun));
    }

    #[test]
    fn frequency_defaults_to_every_flow() {
        assert_eq!(frequency(None), Frequency::Every);
        assert_eq!(frequency(Some("unknown")), Frequency::Every);
        assert_eq!(frequency(Some("every-5-flows")), Frequency::EveryN(5));
    }
}
