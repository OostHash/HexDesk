//! Waiting for writes to files in a directory, so a log can be read the moment
//! it changes instead of on a fixed poll interval.

use std::path::Path;
use std::time::Duration;

/// Watches one directory for files being written.
pub struct DirWatch {
    inner: imp::DirWatch,
}

impl DirWatch {
    /// Starts watching `dir`. `None` when the operating system cannot watch
    /// it; callers then poll instead.
    pub fn new(dir: &Path) -> Option<Self> {
        imp::DirWatch::new(dir).map(|inner| Self { inner })
    }

    /// Returns when a file in the directory was written since the last call,
    /// or once `timeout` has passed.
    pub fn wait(&self, timeout: Duration) {
        self.inner.wait(timeout);
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
        FILE_NOTIFY_CHANGE_LAST_WRITE,
    };
    use windows_sys::Win32::System::Threading::WaitForSingleObject;

    pub(super) struct DirWatch {
        handle: HANDLE,
    }

    // The change notification handle is only waited on and re-armed, which
    // Windows allows from any thread.
    unsafe impl Send for DirWatch {}

    impl DirWatch {
        pub(super) fn new(dir: &Path) -> Option<Self> {
            let dir: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
            // SAFETY: `dir` is a NUL-terminated UTF-16 path that outlives the call.
            let handle = unsafe {
                FindFirstChangeNotificationW(dir.as_ptr(), 0, FILE_NOTIFY_CHANGE_LAST_WRITE)
            };
            (handle != INVALID_HANDLE_VALUE).then_some(Self { handle })
        }

        pub(super) fn wait(&self, timeout: Duration) {
            let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1);
            // SAFETY: the handle is open until `drop`.
            unsafe {
                WaitForSingleObject(self.handle, millis);
                FindNextChangeNotification(self.handle);
            }
        }
    }

    impl Drop for DirWatch {
        fn drop(&mut self) {
            // SAFETY: the handle was opened in `new` and is not used after this.
            unsafe { FindCloseChangeNotification(self.handle) };
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;
    use std::time::Duration;

    pub(super) struct DirWatch;

    impl DirWatch {
        pub(super) fn new(_dir: &Path) -> Option<Self> {
            None
        }

        pub(super) fn wait(&self, _timeout: Duration) {}
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn a_write_wakes_the_watch_before_the_timeout() {
        let dir = std::env::temp_dir().join(format!("hexdesk-dir-watch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("EE.log");
        std::fs::write(&file, "start\n").unwrap();

        let watch = DirWatch::new(&dir).expect("the directory can be watched");
        let writer = {
            let file = file.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                std::fs::write(&file, "start\nmore\n").unwrap();
            })
        };
        let started = Instant::now();
        watch.wait(Duration::from_secs(10));
        writer.join().unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "woke only after {:?}",
            started.elapsed()
        );

        drop(watch);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn without_writes_the_wait_ends_at_the_timeout() {
        let dir =
            std::env::temp_dir().join(format!("hexdesk-dir-watch-idle-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let watch = DirWatch::new(&dir).expect("the directory can be watched");
        let started = Instant::now();
        watch.wait(Duration::from_millis(150));
        assert!(started.elapsed() >= Duration::from_millis(100));
        drop(watch);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_directory_cannot_be_watched() {
        let dir = std::env::temp_dir().join("hexdesk-dir-watch-does-not-exist");
        assert!(DirWatch::new(&dir).is_none());
    }
}
