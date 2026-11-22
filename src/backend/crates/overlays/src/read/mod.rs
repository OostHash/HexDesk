//! Readers: what OCR read on a screen means.

mod era;
pub mod relic_list;
pub mod reward;
pub mod riven;

pub use era::{era_from_text, era_of_list};
