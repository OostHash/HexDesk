//! settings.json: one JSON object shared by the frontend and the backend.
//!
//! The frontend owns most keys and saves partial objects that are merged over
//! the file. The backend reads a few keys of its own through [`Snapshot`].
//! Every write is a read-modify-write of the whole file under one lock, so
//! writers on different threads (commands, window events) never lose each
//! other's keys.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::atomic_write;

/// The settings object as stored.
pub type Map = serde_json::Map<String, Value>;

/// Keys the backend reads or writes itself.
pub mod keys {
    pub const ONBOARDING_COMPLETED: &str = "onboardingCompleted";
    pub const LOG_RETENTION_DAYS: &str = "logRetentionDays";
    pub const TESTING_ENABLED: &str = "testingEnabled";
    pub const FEEDBACK_FREQUENCY: &str = "feedbackFrequency";
    pub const LAST_VERSION: &str = "lastVersion";
}

pub const DEFAULT_LOG_RETENTION_DAYS: u64 = 1;
pub const MAX_LOG_RETENTION_DAYS: u64 = 5;

/// How often opt-in testing asks for feedback. The stored values match
/// `src/frontend/src/domain/testing.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FeedbackFrequency {
    #[default]
    EveryFlow,
    Every3Flows,
    Every5Flows,
    OncePerRun,
}

impl FeedbackFrequency {
    /// The stored value; unknown values are `None`.
    pub fn parse(value: &str) -> Option<FeedbackFrequency> {
        match value {
            "every-flow" => Some(FeedbackFrequency::EveryFlow),
            "every-3-flows" => Some(FeedbackFrequency::Every3Flows),
            "every-5-flows" => Some(FeedbackFrequency::Every5Flows),
            "once-per-run" => Some(FeedbackFrequency::OncePerRun),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            FeedbackFrequency::EveryFlow => "every-flow",
            FeedbackFrequency::Every3Flows => "every-3-flows",
            FeedbackFrequency::Every5Flows => "every-5-flows",
            FeedbackFrequency::OncePerRun => "once-per-run",
        }
    }

    pub const ALL: [FeedbackFrequency; 4] = [
        FeedbackFrequency::EveryFlow,
        FeedbackFrequency::Every3Flows,
        FeedbackFrequency::Every5Flows,
        FeedbackFrequency::OncePerRun,
    ];

    /// Asks after every n-th completed flow, or `None` for once per run.
    pub const fn every_n_flows(self) -> Option<u64> {
        match self {
            FeedbackFrequency::EveryFlow => Some(1),
            FeedbackFrequency::Every3Flows => Some(3),
            FeedbackFrequency::Every5Flows => Some(5),
            FeedbackFrequency::OncePerRun => None,
        }
    }
}

/// One read of the settings file, with typed access to the backend's keys.
/// Missing or malformed values read as their defaults.
#[derive(Debug, Clone, Default)]
pub struct Snapshot(Map);

impl From<Map> for Snapshot {
    fn from(map: Map) -> Snapshot {
        Snapshot(map)
    }
}

impl Snapshot {
    pub fn map(&self) -> &Map {
        &self.0
    }

    pub fn into_map(self) -> Map {
        self.0
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }

    /// Days of daily logs to keep, within the range the app offers.
    pub fn log_retention_days(&self) -> u64 {
        self.get(keys::LOG_RETENTION_DAYS)
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_LOG_RETENTION_DAYS)
            .clamp(DEFAULT_LOG_RETENTION_DAYS, MAX_LOG_RETENTION_DAYS)
    }

    /// Whether the player opted in to opt-in testing. Off unless stored.
    pub fn testing_enabled(&self) -> bool {
        self.get(keys::TESTING_ENABLED)
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    pub fn feedback_frequency(&self) -> FeedbackFrequency {
        self.get(keys::FEEDBACK_FREQUENCY)
            .and_then(Value::as_str)
            .and_then(FeedbackFrequency::parse)
            .unwrap_or_default()
    }

    pub fn last_version(&self) -> Option<&str> {
        self.get(keys::LAST_VERSION).and_then(Value::as_str)
    }
}

/// The keys one write changed, added or removed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changes(Vec<String>);

impl Changes {
    pub fn contains(&self, key: &str) -> bool {
        self.0.iter().any(|changed| changed == key)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn keys(&self) -> &[String] {
        &self.0
    }

    fn between(before: &Map, after: &Map) -> Changes {
        let mut keys: Vec<String> = after
            .iter()
            .filter(|(key, value)| before.get(*key) != Some(*value))
            .map(|(key, _)| key.clone())
            .chain(
                before
                    .keys()
                    .filter(|key| !after.contains_key(*key))
                    .cloned(),
            )
            .collect();
        keys.sort();
        Changes(keys)
    }
}

type Listener = dyn Fn(&Changes, &Snapshot) + Send + Sync;

/// The settings file. Create one per file and share it: the write lock lives
/// in the store, so two stores for the same file would not serialize.
pub struct Settings {
    path: PathBuf,
    write_lock: Mutex<()>,
    listeners: Mutex<Vec<Arc<Listener>>>,
}

impl Settings {
    pub fn new(path: impl Into<PathBuf>) -> Settings {
        Settings {
            path: path.into(),
            write_lock: Mutex::new(()),
            listeners: Mutex::new(Vec::new()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Reads the file. A missing or empty file is an empty object; a file
    /// that exists but does not parse is an error, so no write replaces it.
    pub fn read(&self) -> Result<Snapshot, String> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(format!("{}: {error}", self.path.display())),
        };
        if raw.trim().is_empty() {
            return Ok(Snapshot::default());
        }
        match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(map)) => Ok(Snapshot(map)),
            _ => Err(format!(
                "{} exists but is not a valid JSON object; refusing to overwrite it",
                self.path.display()
            )),
        }
    }

    /// Like [`Settings::read`], but an unreadable file reads as defaults.
    pub fn snapshot(&self) -> Snapshot {
        self.read().unwrap_or_default()
    }

    /// Applies `apply` to the stored object and writes it back when anything
    /// changed. Listeners run after the write, outside the lock.
    pub fn merge(&self, apply: impl FnOnce(&mut Map)) -> Result<Changes, String> {
        let (changes, written) = {
            // Poison recovery is safe: the lock guards the file, not the map,
            // and a panicking closure bails before the write.
            let _guard = self
                .write_lock
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let before = self.read()?.into_map();
            let mut after = before.clone();
            apply(&mut after);
            let changes = Changes::between(&before, &after);
            if changes.is_empty() {
                return Ok(changes);
            }
            let json = serde_json::to_string(&after).map_err(|error| error.to_string())?;
            atomic_write(&self.path, json.as_bytes())
                .map_err(|error| format!("{}: {error}", self.path.display()))?;
            (changes, Snapshot(after))
        };
        let listeners = self
            .listeners
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        for listener in listeners {
            listener(&changes, &written);
        }
        Ok(changes)
    }

    /// Calls `listener` after every write that changed something, with the
    /// keys that changed and the settings as written.
    pub fn on_change(&self, listener: impl Fn(&Changes, &Snapshot) + Send + Sync + 'static) {
        self.listeners
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(Arc::new(listener));
    }

    /// Adds the keys whose absence means something different on a fresh
    /// install than on an upgrade. Values already stored always win.
    pub fn initialize_installation(&self, fresh_install: bool) -> Result<(), String> {
        self.merge(|map| {
            map.entry(keys::ONBOARDING_COMPLETED)
                .or_insert(Value::Bool(!fresh_install));
            map.entry(keys::LOG_RETENTION_DAYS)
                .or_insert(DEFAULT_LOG_RETENTION_DAYS.into());
            map.entry(keys::TESTING_ENABLED).or_insert(false.into());
            map.entry(keys::FEEDBACK_FREQUENCY)
                .or_insert(FeedbackFrequency::default().as_str().into());
        })
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Each test gets its own file so they can run in parallel.
    fn scratch(name: &str) -> Settings {
        let dir =
            std::env::temp_dir().join(format!("hexdesk-persist-tests-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir is always writable");
        let path = dir.join(format!("{name}.json"));
        let _ = std::fs::remove_file(&path);
        Settings::new(path)
    }

    fn write(settings: &Settings, raw: &str) {
        std::fs::write(settings.path(), raw).expect("scratch file is writable");
    }

    /// A truncated settings.json (crash or app kill mid-write, e.g. during an
    /// update) must not parse as "no settings": the next merge would rewrite
    /// the file from an empty map and wipe tracked and favorites.
    #[test]
    fn a_corrupt_settings_file_is_never_replaced() {
        let settings = scratch("corrupt");
        let truncated = r#"{"tracked":["/Lotus/Weapons/Boar"],"favorites":["/Lo"#;
        write(&settings, truncated);

        let result = settings.merge(|map| {
            map.insert("windowX".into(), 10.into());
        });

        assert!(
            result.is_err(),
            "merging over an unparseable file must refuse"
        );
        let after = std::fs::read_to_string(settings.path()).expect("file still exists");
        assert_eq!(after, truncated, "the corrupt file must be preserved");
    }

    #[test]
    fn a_missing_or_empty_file_is_a_fresh_start() {
        let settings = scratch("fresh");
        assert!(settings
            .read()
            .expect("missing file is fine")
            .map()
            .is_empty());
        write(&settings, "");
        assert!(settings
            .read()
            .expect("empty file is fine")
            .map()
            .is_empty());
        settings
            .merge(|map| {
                map.insert("tracked".into(), serde_json::json!(["a"]));
            })
            .expect("merging into a fresh file succeeds");
    }

    #[test]
    fn merging_preserves_unrelated_keys() {
        let settings = scratch("preserve");
        write(&settings, r#"{"tracked":["a"],"favorites":["b"]}"#);
        settings
            .merge(|map| {
                map.insert("windowX".into(), 42.into());
            })
            .expect("merge succeeds");
        let snapshot = settings.read().expect("file parses");
        assert_eq!(snapshot.get("tracked"), Some(&serde_json::json!(["a"])));
        assert_eq!(snapshot.get("favorites"), Some(&serde_json::json!(["b"])));
        assert_eq!(snapshot.get("windowX"), Some(&serde_json::json!(42)));
    }

    /// Window events write on every move while commands save on their own
    /// thread. Unserialized, one writer could read the file mid-write of the
    /// other and resurrect a stale or empty map.
    #[test]
    fn concurrent_merges_do_not_lose_keys() {
        let settings = scratch("concurrent");
        write(&settings, r#"{"tracked":["a"]}"#);
        std::thread::scope(|s| {
            for t in 0..8 {
                let settings = &settings;
                s.spawn(move || {
                    for i in 0..25 {
                        settings
                            .merge(|map| {
                                map.insert(format!("k{t}_{i}"), i.into());
                            })
                            .expect("merge never fails on a valid file");
                    }
                });
            }
        });
        let snapshot = settings.read().expect("file parses after the storm");
        assert_eq!(snapshot.get("tracked"), Some(&serde_json::json!(["a"])));
        for t in 0..8 {
            for i in 0..25 {
                assert!(
                    snapshot.get(&format!("k{t}_{i}")).is_some(),
                    "lost k{t}_{i}"
                );
            }
        }
    }

    #[test]
    fn changes_name_changed_added_and_removed_keys() {
        let settings = scratch("changes");
        write(&settings, r#"{"same":1,"changed":1,"removed":1}"#);
        let changes = settings
            .merge(|map| {
                map.insert("same".into(), 1.into());
                map.insert("changed".into(), 2.into());
                map.insert("added".into(), 1.into());
                map.remove("removed");
            })
            .expect("merge succeeds");
        assert_eq!(changes.keys(), ["added", "changed", "removed"]);
    }

    #[test]
    fn listeners_hear_only_writes_that_changed_something() {
        let settings = scratch("listeners");
        let heard = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&heard);
        settings.on_change(move |changes, written| {
            if changes.contains(keys::LOG_RETENTION_DAYS) {
                assert!(written.log_retention_days() >= 3);
                counter.fetch_add(1, Ordering::SeqCst);
            }
        });
        let set = |days: u64| {
            settings
                .merge(|map| {
                    map.insert(keys::LOG_RETENTION_DAYS.into(), days.into());
                })
                .expect("merge succeeds")
        };
        set(3);
        assert!(set(3).is_empty(), "an unchanged value writes nothing");
        set(4);
        assert_eq!(heard.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn only_a_fresh_install_waits_for_onboarding() {
        let fresh = scratch("fresh-onboarding");
        fresh
            .initialize_installation(true)
            .expect("fresh settings are initialized");
        let snapshot = fresh.read().expect("fresh settings parse");
        assert_eq!(
            snapshot.get(keys::ONBOARDING_COMPLETED),
            Some(&serde_json::json!(false))
        );
        assert!(!snapshot.testing_enabled());
        assert_eq!(snapshot.log_retention_days(), 1);
        assert_eq!(
            snapshot.get(keys::FEEDBACK_FREQUENCY),
            Some(&serde_json::json!("every-flow"))
        );

        let upgrade = scratch("upgrade-onboarding");
        write(&upgrade, r#"{"favorites":["a"]}"#);
        upgrade
            .initialize_installation(false)
            .expect("upgrade settings are initialized");
        let snapshot = upgrade.read().expect("upgrade settings parse");
        assert_eq!(
            snapshot.get(keys::ONBOARDING_COMPLETED),
            Some(&serde_json::json!(true))
        );
        assert_eq!(snapshot.get("favorites"), Some(&serde_json::json!(["a"])));
    }

    #[test]
    fn installation_defaults_never_replace_a_saved_choice() {
        let settings = scratch("onboarding-choice");
        write(
            &settings,
            r#"{"onboardingCompleted":false,"testingEnabled":true,"logRetentionDays":4,"feedbackFrequency":"once-per-run"}"#,
        );

        settings
            .initialize_installation(false)
            .expect("settings are initialized");
        let snapshot = settings.read().expect("settings parse");
        assert_eq!(
            snapshot.get(keys::ONBOARDING_COMPLETED),
            Some(&serde_json::json!(false))
        );
        assert!(snapshot.testing_enabled());
        assert_eq!(snapshot.log_retention_days(), 4);
        assert_eq!(snapshot.feedback_frequency(), FeedbackFrequency::OncePerRun);
    }

    #[test]
    fn log_retention_is_clamped_to_the_supported_range() {
        let settings = scratch("retention");
        assert_eq!(settings.snapshot().log_retention_days(), 1);
        write(&settings, r#"{"logRetentionDays":99}"#);
        assert_eq!(settings.snapshot().log_retention_days(), 5);
        write(&settings, r#"{"logRetentionDays":0}"#);
        assert_eq!(settings.snapshot().log_retention_days(), 1);
    }

    #[test]
    fn feedback_frequency_round_trips_and_defaults_to_every_flow() {
        for frequency in FeedbackFrequency::ALL {
            assert_eq!(
                FeedbackFrequency::parse(frequency.as_str()),
                Some(frequency)
            );
        }
        let settings = scratch("frequency");
        write(&settings, r#"{"feedbackFrequency":"unknown"}"#);
        assert_eq!(
            settings.snapshot().feedback_frequency(),
            FeedbackFrequency::EveryFlow
        );
    }

    /// The frontend offers these choices from its own list; both sides must
    /// store the same values.
    #[test]
    fn the_frontend_offers_the_same_choices() {
        let frontend = include_str!("../../../../frontend/src/domain/testing.ts");
        let quoted_after = |marker: &str| -> Vec<String> {
            frontend
                .split(marker)
                .skip(1)
                .filter_map(|rest| rest.split('"').next().map(str::to_string))
                .collect()
        };
        let frequencies = quoted_after("{ value: \"");
        let expected: Vec<String> = FeedbackFrequency::ALL
            .iter()
            .map(|frequency| frequency.as_str().to_string())
            .collect();
        assert_eq!(frequencies, expected);

        let days = frontend
            .split("LOG_RETENTION_DAYS = [")
            .nth(1)
            .and_then(|rest| rest.split(']').next())
            .expect("the frontend lists its retention choices");
        let days: Vec<u64> = days
            .split(',')
            .map(|day| day.trim().parse().expect("a whole number of days"))
            .collect();
        let expected: Vec<u64> = (DEFAULT_LOG_RETENTION_DAYS..=MAX_LOG_RETENTION_DAYS).collect();
        assert_eq!(days, expected);
    }
}
