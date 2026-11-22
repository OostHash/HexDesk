//! Screen captures saved for the activity console, so a user can see what OCR
//! was given. Only the newest few are kept.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use hexdesk_diag::{DiagError, Kind, Source};

/// How many captures are kept; older ones are removed when a new one is saved.
/// A visit to a relic list saves two or three, so this keeps about twenty.
const KEEP: usize = 60;

/// Whether screen reads save what OCR was given (activity console setting).
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Whether the overlay window is saved each time it is drawn (activity
/// console setting).
static SCREENSHOTS: AtomicBool = AtomicBool::new(false);

/// Whether each screen read also saves the game frame with the areas it
/// reads outlined (activity console setting).
static AREAS: AtomicBool = AtomicBool::new(false);

/// The same areas are saved at most this often: a read retries several
/// times a second, and its areas do not move.
const AREAS_EVERY: std::time::Duration = std::time::Duration::from_secs(10);

/// Whether screen reads save their read areas.
pub(crate) fn areas() -> bool {
    AREAS.load(Ordering::SeqCst)
}

/// Turns saving the read areas on or off.
#[tauri::command]
pub(crate) fn set_overlay_areas(enabled: bool) {
    AREAS.store(enabled, Ordering::SeqCst);
}

/// Saves the game frame with `areas` outlined as `areas-<name>-<time>.bmp`,
/// when that option is on and these areas were not saved in the last
/// [`AREAS_EVERY`]. Logs the file name under the overlay key's source.
pub(crate) fn save_areas(
    name: &str,
    frame: &hexdesk_capture::Frame,
    areas: &[hexdesk_capture::Rect],
) {
    static LAST: std::sync::Mutex<Vec<(String, std::time::Instant)>> =
        std::sync::Mutex::new(Vec::new());
    if !AREAS.load(Ordering::SeqCst) {
        return;
    }
    {
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if last
            .iter()
            .any(|(n, at)| n == name && at.elapsed() < AREAS_EVERY)
        {
            return;
        }
        last.retain(|(n, _)| n != name);
        last.push((name.to_string(), std::time::Instant::now()));
    }
    let mut marked = frame.clone();
    let thickness = (frame.width / 640).max(2);
    for area in areas {
        marked.outline(*area, thickness);
    }
    if let Some(file) = save(&format!("areas-{name}"), &marked.to_bmp()) {
        hexdesk_diag::info!(overlay, capture = %file, "Read areas saved: {name}");
    }
}

/// Whether overlays save a screenshot once drawn.
pub(crate) fn screenshots() -> bool {
    SCREENSHOTS.load(Ordering::SeqCst)
}

/// Turns saving a screenshot each time an overlay is drawn on or off.
#[tauri::command]
pub(crate) fn set_overlay_screenshot(enabled: bool) {
    SCREENSHOTS.store(enabled, Ordering::SeqCst);
}

/// Whether screen reads save their captures.
pub(crate) fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Turns saving captures on or off.
pub(crate) fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
}

fn dir() -> PathBuf {
    crate::paths::state_dir().join("captures")
}

/// Removes every OCR capture and its saved read. The folder is recreated by
/// the next capture that is enabled.
pub(crate) fn remove_all() -> Result<(), String> {
    let path = dir();
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Whether `name` is a plain capture file name, so it cannot reach outside
/// the captures folder.
pub(crate) fn valid_name(name: &str) -> bool {
    name.ends_with(".bmp")
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Saves a .bmp capture as `<prefix>-<time>.bmp` and returns the file name,
/// or None when it could not be written (logged).
pub(crate) fn save(prefix: &str, bmp: &[u8]) -> Option<String> {
    save_files(prefix, bmp, None)
}

/// Saves a capture with what OCR read in it: `<prefix>-<time>.bmp` and, next
/// to it, `<prefix>-<time>.json`. A recorded pair is a test fixture for the
/// readers. Returns the .bmp file name, or None when it could not be written
/// (logged).
pub(crate) fn save_read(
    prefix: &str,
    bmp: &[u8],
    read: &hexdesk_capture::TextRead,
) -> Option<String> {
    save_files(prefix, bmp, Some(read))
}

fn save_files(
    prefix: &str,
    bmp: &[u8],
    read: Option<&hexdesk_capture::TextRead>,
) -> Option<String> {
    let dir = dir();
    let stem = format!(
        "{prefix}-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let name = format!("{stem}.bmp");
    let written = std::fs::create_dir_all(&dir)
        .and_then(|()| std::fs::write(dir.join(&name), bmp))
        .and_then(|()| match read {
            Some(read) => std::fs::write(dir.join(format!("{stem}.json")), read.to_json()),
            None => Ok(()),
        });
    if let Err(e) = written {
        let _ = DiagError::new(
            Source::Overlay,
            Kind::Io,
            "Screen capture could not be saved",
        )
        .with("file", &name)
        .caused_by(&e)
        .log();
        return None;
    }
    prune(&dir, KEEP);
    Some(name)
}

/// The time part of a capture file name ("20261120-114814-617"), which
/// orders captures of every kind by age.
fn time_of(name: &str) -> &str {
    let stem = name.strip_suffix(".bmp").unwrap_or(name);
    &stem[stem.len().saturating_sub(19)..]
}

/// Removes all but the `keep` newest captures, with their OCR reads.
fn prune(dir: &Path, keep: usize) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = read
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| valid_name(n))
        .collect();
    names.sort_by(|a, b| time_of(a).cmp(time_of(b)));
    let excess = names.len().saturating_sub(keep);
    for name in names.into_iter().take(excess) {
        let _ = std::fs::remove_file(dir.join(&name));
        let _ = std::fs::remove_file(dir.join(name.replace(".bmp", ".json")));
    }
}

/// A saved capture as raw .bmp bytes, for the activity console.
#[tauri::command]
pub(crate) fn get_capture(name: String) -> Result<tauri::ipc::Response, DiagError> {
    if !valid_name(&name) {
        return Err(
            DiagError::new(Source::Overlay, Kind::Invalid, "Not a capture file name")
                .with("file", &name),
        );
    }
    std::fs::read(dir().join(&name))
        .map(tauri::ipc::Response::new)
        .map_err(|e| {
            DiagError::new(Source::Overlay, Kind::NotFound, "Screen capture not found")
                .with("file", &name)
                .caused_by(&e)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_capture_names_are_valid() {
        assert!(valid_name("overlay-key-20261119-214501-123.bmp"));
        assert!(!valid_name("../logs/hexdesk.log"));
        assert!(!valid_name("..\\secret.bmp"));
        assert!(!valid_name("overlay-key.png"));
        assert!(!valid_name(".bmp"));
    }

    #[test]
    fn pruning_keeps_the_newest() {
        let dir = std::env::temp_dir().join(format!("hexdesk-captures-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..5 {
            std::fs::write(dir.join(format!("k-2026111{i}.bmp")), b"x").unwrap();
        }
        prune(&dir, 2);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, vec!["k-20261113.bmp", "k-20261114.bmp"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pruning_goes_by_time_across_kinds_and_takes_the_read_along() {
        let dir =
            std::env::temp_dir().join(format!("hexdesk-captures-kinds-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "relic-pick-era-20261120-114814-617.bmp",
            "relic-pick-era-20261120-114814-617.json",
            "overlay-key-20261120-114832-739.bmp",
            "relic-list-20261120-114833-191.bmp",
        ] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        prune(&dir, 2);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                "overlay-key-20261120-114832-739.bmp",
                "relic-list-20261120-114833-191.bmp"
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
