//! HexDesk item details: what a mod or arcane is and does, from the WFCD item
//! data (<https://github.com/WFCD/warframe-items>).
//!
//! The crate has no I/O. The app hands it the parsed `Mods.json` and
//! `Arcanes.json`; [`Index`] answers the details of one item by its unique
//! name and the few facts an item card shows.

pub mod details;
pub mod parse;
pub mod text;

pub use details::{drain_at, ArcaneDetails, CardMeta, Drop, ItemDetails, ModDetails, RankStats};
pub use parse::Index;
