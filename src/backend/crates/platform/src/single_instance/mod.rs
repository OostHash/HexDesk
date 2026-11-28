//! One running instance per user session.
//!
//! The first start claims a named lock. A later start finds it taken, wakes
//! the running instance so it can bring its window to the front, and is told
//! to exit. The operating system releases the lock when the process ends, so
//! a crash never blocks the next start.

use std::io;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as imp;

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
use other as imp;

/// What [`start`] found.
pub enum Start {
    /// No other instance holds the key; this process owns it from now on.
    First(Instance),
    /// Another instance holds the key and has been asked to show itself.
    AlreadyRunning,
}

/// The claim of the running instance. Dropping it releases the claim.
pub struct Instance {
    inner: imp::Instance,
}

/// Claims `key` for this process, or wakes the instance that holds it.
///
/// Builds that should run side by side need different keys. A key may only
/// contain ASCII letters, digits, `.`, `-` and `_`.
pub fn start(key: &str) -> io::Result<Start> {
    let names = ObjectNames::for_key(key)?;
    Ok(match imp::start(&names)? {
        Some(inner) => Start::First(Instance { inner }),
        None => Start::AlreadyRunning,
    })
}

impl Instance {
    /// Calls `on_start` on a background thread each time another start of the
    /// same key is handed over to this instance.
    pub fn on_second_start<F>(&self, on_start: F) -> io::Result<()>
    where
        F: Fn() + Send + 'static,
    {
        self.inner.on_second_start(on_start)
    }

    /// Gives up the claim while the process keeps running, so a new instance
    /// started now (such as a restart after an update) becomes the first.
    pub fn release(&self) {
        self.inner.release();
    }
}

/// The names of the lock and of the signal for one key.
#[derive(Debug, PartialEq, Eq)]
struct ObjectNames {
    lock: String,
    signal: String,
}

impl ObjectNames {
    fn for_key(key: &str) -> io::Result<Self> {
        let valid = !key.is_empty()
            && key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'));
        if !valid {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid single-instance key {key:?}"),
            ));
        }
        // `Local\` keeps the names per user session, so other users on the
        // same machine run their own instance.
        Ok(Self {
            lock: format!("Local\\{key}.instance"),
            signal: format!("Local\\{key}.show"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_per_session_and_per_key() {
        let names = ObjectNames::for_key("com.oosthash.hexdesk.dev").unwrap();
        assert_eq!(names.lock, "Local\\com.oosthash.hexdesk.dev.instance");
        assert_eq!(names.signal, "Local\\com.oosthash.hexdesk.dev.show");
    }

    #[test]
    fn keys_with_separators_or_spaces_are_rejected() {
        for key in ["", "a\\b", "a/b", "a b", "hex€desk"] {
            let error = ObjectNames::for_key(key).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{key:?}");
        }
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    // Unique per test and process, so tests never meet a running HexDesk or
    // each other.
    fn test_key() -> String {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        format!(
            "hexdesk-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn a_second_start_finds_the_first_running() {
        let key = test_key();
        let first = start(&key).unwrap();
        assert!(matches!(first, Start::First(_)));
        assert!(matches!(start(&key).unwrap(), Start::AlreadyRunning));
    }

    #[test]
    fn a_second_start_wakes_the_first() {
        let key = test_key();
        let Start::First(instance) = start(&key).unwrap() else {
            panic!("first start did not claim the key");
        };
        let (sender, receiver) = mpsc::channel();
        instance
            .on_second_start(move || {
                let _ = sender.send(());
            })
            .unwrap();

        assert!(matches!(start(&key).unwrap(), Start::AlreadyRunning));
        receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("the running instance was not woken");
        assert!(matches!(start(&key).unwrap(), Start::AlreadyRunning));
        receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("the running instance was not woken a second time");
    }

    #[test]
    fn a_released_key_can_be_claimed_again() {
        let key = test_key();
        let Start::First(instance) = start(&key).unwrap() else {
            panic!("first start did not claim the key");
        };
        instance.release();
        instance.release();
        assert!(matches!(start(&key).unwrap(), Start::First(_)));
    }

    #[test]
    fn dropping_the_instance_releases_the_key() {
        let key = test_key();
        drop(start(&key).unwrap());
        assert!(matches!(start(&key).unwrap(), Start::First(_)));
    }

    #[test]
    fn different_keys_do_not_meet() {
        let _first = start(&test_key()).unwrap();
        assert!(matches!(start(&test_key()).unwrap(), Start::First(_)));
    }
}
