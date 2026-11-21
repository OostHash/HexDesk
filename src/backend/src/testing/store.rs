//! Test samples on disk, under `testing/` in the state folder.
//!
//! `pending/visit-<id>/` holds what screen reads saved for one tracker visit.
//! A reported flow moves its visit folders to `runs/run-<id>/flow-<id>-<kind>/`.
//! An export writes all of `runs/` as one zip in Downloads and removes it.
//!
//! Screen reads save from their own threads. Every save holds [`SAVING`]
//! while it checks and writes, so stopping a visit or removing all data never
//! races a save that is still writing.
//!
//! A black capture, or one that shows the same screen as the last capture
//! saved under the same name, is left out with its OCR result: screen reads
//! repeat several times a second, and a report full of copies of one screen
//! is harder to review and much larger.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use hexdesk_overlays::feedback::RunId;
use hexdesk_overlays::{Flow, SampleStore, VisitId};

use super::thumbnail::Thumbnail;

/// A visit whose screen reads are saved, with the last capture saved under
/// each file name prefix.
struct Saving {
    visit: VisitId,
    last: Vec<(String, Thumbnail)>,
}

/// The visits whose screen reads are saved.
static SAVING: Mutex<Vec<Saving>> = Mutex::new(Vec::new());
static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn saving() -> MutexGuard<'static, Vec<Saving>> {
    SAVING.lock().unwrap_or_else(|error| error.into_inner())
}

/// Why a capture is not saved, or `None` to save it.
fn skip_reason(last: Option<&Thumbnail>, capture: Option<&Thumbnail>) -> Option<&'static str> {
    let capture = capture?;
    if capture.is_black() {
        Some("black capture")
    } else if last.is_some_and(|last| last.same_screen(capture)) {
        Some("same screen as the previous capture")
    } else {
        None
    }
}

fn root() -> PathBuf {
    crate::paths::state_dir().join("testing")
}

fn visit_dir(visit: VisitId) -> PathBuf {
    root().join("pending").join(format!("visit-{visit}"))
}

fn runs_dir() -> PathBuf {
    root().join("runs")
}

fn run_dir(run: RunId) -> PathBuf {
    runs_dir().join(format!("run-{run}"))
}

/// Whether screen reads of `visit` are saved.
pub(crate) fn capturing(visit: VisitId) -> bool {
    saving().iter().any(|saving| saving.visit == visit)
}

/// Saves pixels and their structured OCR result for `visit`.
pub(crate) fn save_read(
    visit: VisitId,
    prefix: &str,
    bmp: &[u8],
    read: &hexdesk_capture::TextRead,
) {
    save(visit, prefix, bmp, Some(read.to_json().as_bytes()));
}

/// Saves pixels and a caller-provided JSON OCR result for `visit`.
pub(crate) fn save_json(visit: VisitId, prefix: &str, bmp: &[u8], json: &[u8]) {
    save(visit, prefix, bmp, Some(json));
}

/// Saves the combined game-and-overlay image needed to review the flow.
pub(crate) fn save_overlay(visit: VisitId, prefix: &str, bmp: &[u8]) {
    save(visit, prefix, bmp, None);
}

fn save(visit: VisitId, prefix: &str, bmp: &[u8], json: Option<&[u8]>) {
    let mut saving = saving();
    let Some(entry) = saving.iter_mut().find(|saving| saving.visit == visit) else {
        return;
    };
    let capture = Thumbnail::from_bmp(bmp);
    let last = entry
        .last
        .iter()
        .find(|(name, _)| name == prefix)
        .map(|(_, thumbnail)| thumbnail);
    if let Some(reason) = skip_reason(last, capture.as_ref()) {
        drop(saving);
        hexdesk_diag::debug!(overlay, visit, prefix, reason, "Test sample not saved");
        return;
    }
    if let Some(capture) = capture {
        entry.last.retain(|(name, _)| name != prefix);
        entry.last.push((prefix.to_string(), capture));
    }
    let mut files = vec![("bmp", bmp)];
    files.extend(json.map(|json| ("json", json)));
    let dir = visit_dir(visit);
    let sequence = FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stem = format!(
        "{prefix}-{}-{sequence}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let result = std::fs::create_dir_all(&dir).and_then(|()| {
        files.iter().try_for_each(|(extension, bytes)| {
            std::fs::write(dir.join(format!("{stem}.{extension}")), bytes)
        })
    });
    drop(saving);
    if let Err(error) = result {
        hexdesk_diag::debug!(
            overlay,
            visit,
            reason = %error,
            "Pending test sample could not be saved"
        );
    }
}

/// Stops every save and removes all test data. Used directly when the
/// overlay runtime is not running.
pub(crate) fn remove_all_files() -> Result<(), String> {
    let mut saving = saving();
    saving.clear();
    let root = root();
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The [`SampleStore`] of the overlay runtime.
pub(crate) struct FsStore;

impl FsStore {
    /// Pending means unanswered, so a restart counts as ignoring it.
    /// Reported flows stay until they are exported or discarded.
    pub(crate) fn new() -> FsStore {
        let pending = root().join("pending");
        if pending.exists() {
            let _ = std::fs::remove_dir_all(pending);
        }
        FsStore
    }
}

/// Counts the reported flows in the run folders under `runs` and removes
/// run folders without any.
fn kept_in(runs: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(runs) else {
        return 0;
    };
    let mut kept = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_run = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("run-"))
            .is_some_and(|id| id.parse::<RunId>().is_ok());
        if !is_run {
            continue;
        }
        let flows = std::fs::read_dir(&path).map_or(0, |flows| {
            flows.flatten().filter(|flow| flow.path().is_dir()).count()
        });
        if flows == 0 {
            let _ = std::fs::remove_dir_all(&path);
        }
        kept += flows;
    }
    kept
}

impl SampleStore for FsStore {
    fn begin(&mut self, visit: VisitId) {
        let mut saving = saving();
        if !saving.iter().any(|saving| saving.visit == visit) {
            saving.push(Saving {
                visit,
                last: Vec::new(),
            });
        }
    }

    fn stop(&mut self, flow: &Flow) {
        saving().retain(|saving| !flow.visits.contains(&saving.visit));
    }

    fn has_samples(&self, flow: &Flow) -> bool {
        flow.visits.iter().any(|visit| {
            std::fs::read_dir(visit_dir(*visit))
                .ok()
                .is_some_and(|mut entries| entries.next().is_some())
        })
    }

    fn discard(&mut self, flow: &Flow) {
        self.stop(flow);
        for visit in &flow.visits {
            let path = visit_dir(*visit);
            if path.exists() {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }

    fn keep(&mut self, run: RunId, flow: &Flow) -> Result<(), String> {
        self.stop(flow);
        let destination = run_dir(run).join(format!("flow-{}-{}", flow.id, flow.kind.name()));
        std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
        let description = serde_json::to_vec_pretty(&serde_json::json!({
            "flow": flow.id,
            "kind": flow.kind.name(),
            "visits": flow.visits,
        }))
        .map_err(|error| error.to_string())?;
        std::fs::write(destination.join("flow.json"), description)
            .map_err(|error| error.to_string())?;
        for visit in &flow.visits {
            let source = visit_dir(*visit);
            if source.exists() {
                std::fs::rename(&source, destination.join(format!("visit-{visit}")))
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn kept(&self) -> usize {
        kept_in(&runs_dir())
    }

    fn export(&mut self) -> Result<PathBuf, String> {
        let source = runs_dir();
        let output_dir = dirs::download_dir().unwrap_or_else(|| root().join("reports"));
        std::fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
        let output = output_dir.join(format!(
            "hexdesk-test-report-{}.zip",
            chrono::Local::now().format("%Y-%m-%d-%H%M%S")
        ));
        let mut bundle = hexdesk_diag::Bundle::new();
        bundle.add_text(
            "README.txt",
            "HexDesk opt-in screen-reading test report. This archive contains only flows marked wrong, grouped by run. It is not uploaded automatically.
",
        );
        add_tree(&mut bundle, &source, &source)?;
        bundle
            .write_to(&output)
            .map_err(|error| error.to_string())?;
        let _ = std::fs::remove_dir_all(source);
        Ok(output)
    }

    fn discard_reports(&mut self) -> Result<(), String> {
        let runs = runs_dir();
        if runs.exists() {
            std::fs::remove_dir_all(runs).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn remove_all(&mut self) -> Result<(), String> {
        remove_all_files()
    }
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
    use super::{kept_in, skip_reason};
    use crate::testing::thumbnail::Thumbnail;

    fn thumbnail(value: u8) -> Thumbnail {
        let bgra = vec![value; 64 * 36 * 4];
        Thumbnail::from_bmp(&hexdesk_capture::bgra_to_bmp(&bgra, 64, 36)).expect("a capture bmp")
    }

    #[test]
    fn black_and_repeated_captures_are_skipped() {
        let screen = thumbnail(120);
        assert_eq!(skip_reason(None, Some(&screen)), None);
        assert_eq!(
            skip_reason(None, Some(&thumbnail(0))),
            Some("black capture")
        );
        assert_eq!(
            skip_reason(Some(&screen), Some(&thumbnail(121))),
            Some("same screen as the previous capture")
        );
        assert_eq!(skip_reason(Some(&screen), Some(&thumbnail(200))), None);
        assert_eq!(
            skip_reason(Some(&screen), None),
            None,
            "unreadable images are kept"
        );
    }

    #[test]
    fn kept_flows_are_counted_and_empty_runs_removed() {
        let runs = std::env::temp_dir().join(format!("hexdesk-kept-runs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&runs);
        std::fs::create_dir_all(runs.join("run-7/flow-1-reward")).expect("scratch is writable");
        std::fs::create_dir_all(runs.join("run-7/flow-2-riven")).expect("scratch is writable");
        std::fs::create_dir_all(runs.join("run-8/flow-3-riven")).expect("scratch is writable");
        std::fs::create_dir_all(runs.join("run-9")).expect("scratch is writable");
        std::fs::create_dir_all(runs.join("notes/flow-4-riven")).expect("scratch is writable");

        assert_eq!(kept_in(&runs), 3);
        assert!(!runs.join("run-9").exists());
        assert!(runs.join("notes").exists());
        let _ = std::fs::remove_dir_all(runs);
    }
}
