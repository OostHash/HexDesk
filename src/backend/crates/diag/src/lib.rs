//! HexDesk diagnostics: the single route for errors and log entries.
//!
//! Every log event and every [`DiagError`] ends up as one [`Entry`] in the
//! [`Collector`]. The collector writes the log file, keeps recent entries in
//! memory for the activity console and the diagnostics export, and collapses
//! repeats of the same entry.
//!
//! # Writing log messages
//!
//! The log records what happened, never what we think it means.
//!
//! - Shape: `What failed: why`, for example
//!   `Account blob not found: 0 of 412 memory regions matched`.
//! - The reason is what the code observed. No guesses, hints or advice.
//! - English, capital first letter, no trailing full stop.
//! - Details that vary go in fields (`attempt = "3/3"`), not in the message.
//!   Field names are `snake_case`.
//! - Facts that matter for a step are logged as fields on that step, for
//!   example `elevated = false` on "Process found".
//! - No raw data or dumps. Those belong to the raw capture tools.
//! - Secrets are redacted automatically (see [`redact`]), but do not log them
//!   on purpose either.
//!
//! # Logging
//!
//! ```ignore
//! let op = hexdesk_diag::op!(scanner, "Inventory scan");
//! let _guard = op.enter();
//! hexdesk_diag::info!(scanner, attempt = "1/3", "Scan started");
//! hexdesk_diag::debug!(scanner, pid, elevated, "Process found");
//! ```
//!
//! # Errors
//!
//! ```ignore
//! use hexdesk_diag::{DiagError, Kind, ResultExt, Source};
//!
//! let bytes = std::fs::read(&path).diag(Source::Settings, Kind::Io, "Settings could not be read")?;
//!
//! return Err(DiagError::new(Source::Scanner, Kind::NotFound, "Account blob not found: 0 of 412 memory regions matched")
//!     .with("attempt", "3/3")
//!     .log());
//! ```

mod collector;
mod entry;
mod error;
mod export;
mod layer;
mod macros;
pub mod redact;
mod source;

pub use collector::{Collector, Config};
pub use entry::{Entry, Level, Repeat};
pub use error::{DiagError, OptionExt, ResultExt};
pub use export::Bundle;
pub use layer::DiagLayer;
pub use source::{sources, Kind, Source};

#[doc(hidden)]
pub use tracing as __tracing;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

static GLOBAL: OnceLock<Arc<Collector>> = OnceLock::new();
static NEXT_OP: AtomicU64 = AtomicU64::new(1);

/// Installs the app-wide collector and returns the tracing layer that feeds
/// it. Only the first call installs; later calls return a layer for the
/// collector that is already installed.
pub fn install(collector: Collector) -> DiagLayer {
    let collector = GLOBAL.get_or_init(|| Arc::new(collector));
    DiagLayer::new(collector.clone())
}

/// The app-wide collector, if [`install`] was called.
pub fn collector() -> Option<&'static Arc<Collector>> {
    GLOBAL.get()
}

/// The most recent entries, oldest first. Empty before [`install`].
pub fn recent(limit: usize) -> Vec<Entry> {
    collector().map(|c| c.recent(limit)).unwrap_or_default()
}

/// Writes pending repeat counts to the log. Call before an export and on
/// shutdown, so no repeats are lost.
pub fn flush() {
    if let Some(c) = collector() {
        c.flush();
    }
}

/// Hands out the id for a new operation. Used by [`op!`].
#[doc(hidden)]
pub fn next_op_id() -> u64 {
    NEXT_OP.fetch_add(1, Ordering::Relaxed)
}
