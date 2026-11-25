//! HexDesk player state: what the player owns, where each count comes from,
//! and what that means for item sets.
//!
//! The crate has no I/O. The app hands it the catalogue (items and recipes)
//! and an [`Inventory`]: the last inventory scan, rewards seen in EE.log since
//! then and Foundry jobs, each with its time. Every count it returns carries
//! the [`Evidence`] it was made from, so an overlay can log why it says an
//! item is owned or missing.
//!
//! [`ScanState`] keeps what each section of the account blob last said, so a
//! blob that lacks a section updates every other section and keeps that one.

pub mod catalogue;
pub mod inventory;
pub mod scan;
pub mod sets;

pub use catalogue::{Catalogue, Item, RecipeLine};
pub use inventory::{Count, Evidence, Inventory, Source};
pub use scan::{SavedScan, SavedSection, ScanOutcome, ScanState, SectionOutcome, EMPTY_AFTER};
pub use sets::{RewardCard, SetPart};

/// Milliseconds since the Unix epoch.
pub type Millis = i64;

/// A catalogue path as the catalogue writes it: the game's paths for store
/// items carry an extra "/StoreItems" segment.
pub fn catalogue_path(path: &str) -> String {
    path.replace("/Lotus/StoreItems/", "/Lotus/")
}
