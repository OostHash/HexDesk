//! Centralized Tauri event name constants — every `.emit()` call site in the
//! backend should reference one of these instead of a string literal.
//! The frontend lists the same names in `src/frontend/src/api/events.ts`; keep both in sync
//! when adding, renaming, or retiring an event.
//!
//! Some constants here (RIVEN_ROLL_SAVED, RELIC_SCREEN) have no Rust-side
//! `.emit()` call — they're broadcast window-to-window entirely on the
//! frontend. They're kept here anyway so this file stays the single manifest
//! of every event name in the app, next to the frontend's `EventMap`.
#![allow(dead_code)]

pub const SETTINGS_UPDATED: &str = "settings-updated";

pub const RELIC_TRIGGER: &str = "relic-trigger";
pub const RELIC_REWARDS: &str = "relic-rewards";
pub const RELIC_SCREEN: &str = "relic-screen";
pub const RELIC_PICK_OPEN: &str = "relic-pick-open";
pub const RELIC_PICK_CLOSE: &str = "relic-pick-close";

/// What the riven overlay shows, with its view number; null when it hides.
pub const RIVEN_VIEW: &str = "riven-view";
pub const RIVEN_ROLL_SAVED: &str = "riven-roll-saved";
pub const RIVEN_UNVEILED: &str = "riven-unveiled";

pub const INVENTORY_UPDATE: &str = "inventory-update";
pub const INVENTORY_REWARD: &str = "inventory-reward";
pub const CATALOGUE_UPDATED: &str = "catalogue-updated";
pub const BULK_PRICES_UPDATED: &str = "bulk-prices-updated";
pub const TRADE_COMPLETED: &str = "trade-completed";

pub const BLOB_STATUS: &str = "blob-status";
/// One new log entry for the activity console (main window only).
pub const DIAG_ENTRY: &str = "diag-entry";
pub const CACHE_STATUS: &str = "cache-status";
pub const STATUS_LINE: &str = "status-line";
/// A Page Up/Page Down testing prompt shown over the game.
pub const TESTING_FEEDBACK: &str = "testing-feedback";
/// A reported testing flow could not be stored (`error`).
pub const TEST_REPORT: &str = "test-report";
/// How many reported testing flows wait for an export (a number).
pub const TEST_REPORT_FLOWS: &str = "test-report-flows";
/// A short in-game confirmation of an opt-in testing answer or report
/// (`text`, `tone`: "success" or "danger"), shown in the status window.
pub const TESTING_NOTICE: &str = "testing-notice";
pub const PLAYER_NAME: &str = "player-name";

pub const WFM_WHISPER: &str = "wfm-whisper";
pub const WFM_PRICE_UPDATE: &str = "wfm-price-update";
pub const WFM_TOP_PROGRESS: &str = "wfm-top-progress";
pub const WFM_TOP_UPDATED: &str = "wfm-top-updated";
