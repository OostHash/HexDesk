//! HexDesk overlays: which game screen is up, how we know, and which overlay
//! belongs to it.
//!
//! The crate has no I/O. The app feeds it [`Signal`]s (parsed EE.log lines,
//! a screen title read by the overlay key, timers) and carries out the
//! [`Action`]s the [`Tracker`] returns. Every signal also yields one
//! [`Decision`] that says what the signal did and why, so the log can show
//! the whole path from trigger to overlay.
//!
//! Time is passed in with each signal as milliseconds since the Unix epoch,
//! which keeps every scenario reproducible in a unit test.

pub mod ee_log;
pub mod flow;
pub mod read;
pub mod screen;
pub mod signal;
pub mod title;
pub mod tracker;

pub use flow::{Flow, FlowId, FlowKind, FlowTracker};
pub use screen::{Overlay, Screen};
pub use signal::{HideBy, Millis, Signal, SignalKind};
pub use tracker::{Action, Decision, Ignored, LeaveReason, Step, Tracker, Visit, VisitId};
