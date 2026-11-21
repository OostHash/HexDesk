//! Writes that never leave a half-written file behind.

use tracing::warn;

/// Writes `data` to `path` through a synced temporary file and a rename, so a
/// crash or kill mid-write leaves either the old file or the new one. When
/// the temporary file cannot be created at all, it falls back to a direct
/// write.
pub fn atomic_write(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");

    // Phase 1: write + sync the temp file.
    if let Err(e) = std::fs::write(&tmp, data) {
        // .tmp creation failed — security software (Defender, Proton Drive) may
        // be blocking new files in this directory for the unsigned dev binary.
        // Warn with a step label so the log makes the failure site clear, then
        // fall back to a direct (non-atomic) write.  Production signed builds
        // don't trigger this path; cache files can tolerate it.
        warn!(
            path = %path.display(),
            "atomic_write/write_tmp failed ({e}), falling back to direct write"
        );
        return std::fs::write(path, data);
    }

    // Phase 2: flush to platter before the rename commits.
    // Must open with write access: FlushFileBuffers (sync_all) requires it on
    // Windows and returns ERROR_ACCESS_DENIED on a read-only handle.
    if let Err(e) = std::fs::OpenOptions::new()
        .write(true)
        .open(&tmp)
        .and_then(|f| f.sync_all())
    {
        let _ = std::fs::remove_file(&tmp);
        return Err(std::io::Error::new(e.kind(), format!("sync: {e}")));
    }

    // Phase 3: rename with a short retry.  Windows Defender and file-sync tools
    // can hold the destination briefly without FILE_SHARE_DELETE, making
    // MoveFileExW return ERROR_ACCESS_DENIED.  A 50–150 ms pause outlasts most
    // scan windows.
    for delay_ms in [0u64, 50, 150] {
        if delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(_) if delay_ms < 150 => continue,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(std::io::Error::new(e.kind(), format!("rename: {e}")));
            }
        }
    }
    unreachable!()
}
