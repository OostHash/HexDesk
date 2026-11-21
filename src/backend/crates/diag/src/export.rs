//! The diagnostics export: one zip with what a bug report needs.
//!
//! Every file that goes in is redacted on the way in (see [`crate::redact`]).
//! The bundle holds facts only: log files, recent entries, system facts and
//! settings. It adds no summary or interpretation of its own.

use std::io::Write;
use std::path::Path;

use crate::{redact, DiagError, Entry, Kind, Source};

/// Files collected for one export, written with [`Bundle::write_to`].
#[derive(Debug, Default)]
pub struct Bundle {
    files: Vec<(String, Vec<u8>)>,
}

impl Bundle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds an already-sanitized binary file. Used for screenshots whose
    /// bytes must not be interpreted as text by the redactor.
    pub fn add_bytes(&mut self, name: &str, bytes: Vec<u8>) {
        self.files.push((name.to_string(), bytes));
    }

    /// Adds a text file, redacted.
    pub fn add_text(&mut self, name: &str, text: &str) {
        self.files
            .push((name.to_string(), redact::text(text).into_bytes()));
    }

    /// Adds a JSON file, pretty-printed, with sensitive keys redacted.
    pub fn add_json(&mut self, name: &str, mut value: serde_json::Value) {
        redact::json(&mut value);
        let text = serde_json::to_string_pretty(&value).unwrap_or_default();
        self.files.push((name.to_string(), text.into_bytes()));
    }

    /// Adds a log file from disk, redacted. Older logs were written before
    /// redaction existed, so they are redacted again here.
    pub fn add_log_file(&mut self, name: &str, path: &Path) -> std::io::Result<()> {
        let bytes = std::fs::read(path)?;
        let text = String::from_utf8_lossy(&bytes);
        self.add_text(name, &text);
        Ok(())
    }

    /// Adds entries as JSON Lines, one [`Entry`] per line.
    pub fn add_entries(&mut self, name: &str, entries: &[Entry]) {
        let mut out = String::new();
        for entry in entries {
            if let Ok(line) = serde_json::to_string(entry) {
                out.push_str(&line);
                out.push('\n');
            }
        }
        // Entries were redacted when they were recorded; run them through
        // once more for secrets registered since.
        self.add_text(name, &out);
    }

    /// Names of the files in the bundle, in order.
    pub fn names(&self) -> Vec<&str> {
        self.files.iter().map(|(n, _)| n.as_str()).collect()
    }

    /// Writes the bundle as a deflate-compressed zip to `path`.
    pub fn write_to(&self, path: &Path) -> Result<(), DiagError> {
        let fail = |what: &str, e: &dyn std::fmt::Display| {
            DiagError::new(
                Source::App,
                Kind::Io,
                format!("Diagnostics export failed: {what}"),
            )
            .with("path", path.display())
            .caused_by_text(e)
        };
        let file = std::fs::File::create(path)
            .map_err(|e| fail("the zip file could not be created", &e))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in &self.files {
            zip.start_file(name.as_str(), options)
                .map_err(|e| fail("a file could not be added", &e))?;
            zip.write_all(bytes)
                .map_err(|e| fail("a file could not be written", &e))?;
        }
        zip.finish()
            .map_err(|e| fail("the zip could not be finished", &e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn read_zip(path: &Path) -> Vec<(String, String)> {
        let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|i| {
                let mut f = archive.by_index(i).unwrap();
                let mut text = String::new();
                f.read_to_string(&mut text).unwrap();
                (f.name().to_string(), text)
            })
            .collect()
    }

    #[test]
    fn writes_every_file_redacted_into_one_zip() {
        let dir = std::env::temp_dir().join(format!("hexdesk-diag-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("hexdesk.2026-11-18.log");
        std::fs::write(&log, "INFO app Login token=abc for a@b.example\n").unwrap();

        let mut bundle = Bundle::new();
        bundle.add_text("README.txt", "What is inside");
        bundle.add_json(
            "settings.json",
            serde_json::json!({ "wfmToken": "secret", "theme": "dark" }),
        );
        bundle
            .add_log_file("logs/hexdesk.2026-11-18.log", &log)
            .unwrap();
        let out = dir.join("export.zip");
        bundle.write_to(&out).unwrap();

        let files = read_zip(&out);
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            ["README.txt", "settings.json", "logs/hexdesk.2026-11-18.log"]
        );
        assert!(
            files[1].1.contains(r#""wfmToken": "[redacted]""#),
            "{}",
            files[1].1
        );
        assert!(files[1].1.contains(r#""theme": "dark""#));
        assert_eq!(
            files[2].1,
            "INFO app Login token=[redacted] for [redacted]\n"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_folder_is_reported_with_the_path() {
        let path = std::env::temp_dir()
            .join("hexdesk-no-such-dir")
            .join("x.zip");
        let err = Bundle::new().write_to(&path).unwrap_err();
        assert_eq!(err.code(), "app.io");
        assert_eq!(
            err.message(),
            "Diagnostics export failed: the zip file could not be created"
        );
        assert!(!err.causes().is_empty());
    }
}
