//! HexDesk persistence: crash-safe file writes and the settings.json store.
//!
//! Nothing here depends on Tauri, so the rules for how settings are read,
//! defaulted and written can be tested on their own.

mod atomic;
pub mod settings;

pub use atomic::atomic_write;
pub use settings::{Changes, FeedbackFrequency, Map, Settings, Snapshot};
