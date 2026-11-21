//! The daily log files and how long they are kept.
//!
//! Retention is applied in two places. The appender keeps at most
//! `retention_days` files whenever it rolls over to a new day, because it can
//! only count files. [`LogFiles::prune`] removes files older than
//! `retention_days` by age, at start-up and when the retention changes, so
//! files left from days the app did not run do not linger until the next
//! rollover.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{Builder, Rotation};

const PREFIX: &str = "hexdesk";
const SUFFIX: &str = "log";

pub(crate) struct LogFiles {
    dir: PathBuf,
    retention_days: u64,
    /// Dropping the guard flushes the non-blocking writer, so it has to
    /// outlive every log call; otherwise the last events (including a panic)
    /// never reach disk.
    guard: Option<WorkerGuard>,
}

impl LogFiles {
    /// Creates `dir`, removes expired files and opens today's file.
    pub(crate) fn open(
        dir: PathBuf,
        retention_days: u64,
    ) -> Result<(LogFiles, NonBlocking), String> {
        std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        let mut files = LogFiles {
            dir,
            retention_days: retention_days.max(1),
            guard: None,
        };
        files.prune(SystemTime::now());
        let writer = files.writer()?;
        Ok((files, writer))
    }

    /// Detaches the collector from the current file, runs `between` while no
    /// file is open, and attaches a freshly opened file. Logging resumes even
    /// when `between` fails; its error is returned afterwards.
    pub(crate) fn reopen<T>(
        &mut self,
        collector: &hexdesk_diag::Collector,
        between: impl FnOnce(&LogFiles) -> Result<T, String>,
    ) -> Result<T, String> {
        hexdesk_diag::flush();
        collector.take_sink();
        self.close();
        let result = between(self);
        collector.set_sink(self.writer()?);
        result
    }

    pub(crate) fn set_retention(&mut self, days: u64) {
        self.retention_days = days.max(1);
    }

    /// Flushes and closes the current file.
    pub(crate) fn close(&mut self) {
        drop(self.guard.take());
    }

    /// Removes every log file and returns how many there were.
    pub(crate) fn remove_all(&self) -> Result<usize, String> {
        let entries = match std::fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error.to_string()),
        };
        let mut removed = 0;
        for path in entries.flatten().map(|entry| entry.path()) {
            if is_log_file(&path) {
                std::fs::remove_file(&path).map_err(|error| error.to_string())?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Removes log files last written more than `retention_days` before `now`.
    pub(crate) fn prune(&self, now: SystemTime) {
        let cutoff = now
            .checked_sub(Duration::from_secs(
                self.retention_days.saturating_mul(24 * 60 * 60),
            ))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let expired = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .is_ok_and(|modified| modified < cutoff);
            if expired && is_log_file(&entry.path()) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    fn writer(&mut self) -> Result<NonBlocking, String> {
        let appender = Builder::new()
            .rotation(Rotation::DAILY)
            .filename_prefix(PREFIX)
            .filename_suffix(SUFFIX)
            .max_log_files(self.retention_days as usize)
            .build(&self.dir)
            .map_err(|error| error.to_string())?;
        // Non-blocking so the scanner and OCR hot loops never stall on disk I/O.
        let (writer, guard) = tracing_appender::non_blocking(appender);
        self.guard = Some(guard);
        Ok(writer)
    }
}

/// Whether `path` is one of the files this module writes.
fn is_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with(&format!("{PREFIX}.")) && name.ends_with(&format!(".{SUFFIX}"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("hexdesk-logging-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory is writable");
        dir
    }

    fn closed(dir: &Path, retention_days: u64) -> LogFiles {
        LogFiles {
            dir: dir.to_path_buf(),
            retention_days,
            guard: None,
        }
    }

    fn log_files(dir: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(dir)
            .expect("scratch directory is readable")
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| is_log_file(path))
            .collect()
    }

    #[test]
    fn only_hexdesk_logs_count_as_log_files() {
        assert!(is_log_file(Path::new("hexdesk.2026-11-21.log")));
        assert!(!is_log_file(Path::new("notes.log")));
        assert!(!is_log_file(Path::new("hexdesk.2026-11-21.txt")));
    }

    #[test]
    fn pruning_only_removes_expired_hexdesk_logs() {
        let dir = scratch("prune");
        let old_log = dir.join("hexdesk.old.log");
        let unrelated = dir.join("notes.log");
        std::fs::write(&old_log, "old").expect("scratch file is writable");
        std::fs::write(&unrelated, "keep").expect("scratch file is writable");
        let two_days_later = SystemTime::now() + Duration::from_secs(2 * 24 * 60 * 60);

        closed(&dir, 3).prune(two_days_later);
        assert!(old_log.exists(), "inside the retention");
        closed(&dir, 1).prune(two_days_later);
        assert!(!old_log.exists(), "older than the retention");
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn removing_logs_keeps_unrelated_files() {
        let dir = scratch("remove");
        let log = dir.join("hexdesk.2026-11-21.log");
        let unrelated = dir.join("notes.log");
        std::fs::write(&log, "remove").expect("scratch file is writable");
        std::fs::write(&unrelated, "keep").expect("scratch file is writable");

        assert_eq!(closed(&dir, 1).remove_all().expect("logs are removed"), 1);
        assert!(!log.exists());
        assert!(unrelated.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reopening_after_removal_starts_a_fresh_file() {
        let dir = scratch("reopen");
        let old = dir.join("hexdesk.2000-01-01.log");
        std::fs::write(&old, "old").expect("scratch file is writable");
        let collector = hexdesk_diag::Collector::new(hexdesk_diag::Config::default());
        let (mut files, writer) = LogFiles::open(dir.clone(), 1).expect("log files open");
        collector.set_sink(writer);

        let removed = files
            .reopen(&collector, LogFiles::remove_all)
            .expect("reopen succeeds");

        assert!(removed >= 1);
        assert!(!old.exists());
        assert_eq!(log_files(&dir).len(), 1, "today's file is open again");
        files.close();
        let _ = std::fs::remove_dir_all(dir);
    }
}
