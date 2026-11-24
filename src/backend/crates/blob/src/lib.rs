//! HexDesk account blob: the inventory JSON the game keeps in memory.
//!
//! The crate has no I/O. The app reads process memory and stitches regions
//! into a buffer; this crate finds the blob in that buffer and reads what the
//! player owns from it.
//!
//! - [`find_blob_end`], [`blob_seed_offsets`] and [`extract_blob_json`]
//!   locate the blob in a stitched buffer.
//! - [`parse_full_account_blob_checked`] reads a blob into a
//!   [`BlobInventory`], or says why it was not accepted ([`BlobReject`]).
//! - [`read_blob`] reads a blob section by section into a [`BlobRead`], which
//!   says per section whether it was read, missing or unreadable.
//! - [`SECTIONS`] lists the sections that are read and what each one holds.

mod bounds;
mod inventory;
mod parse;
mod read;
mod riven;
mod section_read;
mod sections;

pub use bounds::{
    blob_seed_offsets, extract_blob_json, extract_blob_json_ref, find_blob_end, ALT_STARTS,
    END_MARKERS, END_MARKER_MAX_LEN, START_MARKER,
};
pub use inventory::{
    xp_to_rank, ArchonShard, BlobInventory, BlobPendingRecipe, BlobRivenEntry, BlobRivenStat,
    BlobStackableEntry, BlobUniqueEntry, ModCount, RivenState,
};
pub use parse::{parse_full_account_blob, parse_full_account_blob_checked, read_blob, BlobReject};
pub use riven::compute_riven_mod_name;
pub use section_read::{BlobRead, SectionContent, SectionRead, SectionState};
pub use sections::{Scalar, Section, SectionKind, SECTIONS};
