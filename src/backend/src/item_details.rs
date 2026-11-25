//! Commands for item cards and the item info window: mod and arcane details
//! from `hexdesk-items`, read from the WFCD files the catalogue stores on disk.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use hexdesk_items::{CardMeta, Index, ItemDetails};
use tracing::info;

use crate::wfcd;

static INDEX: Mutex<Option<Arc<Index>>> = Mutex::new(None);

/// The index, built from the stored files on first use. While the catalogue
/// has not stored them yet the index is empty and is not kept, so a later
/// call builds it again.
fn index() -> Arc<Index> {
    let mut slot = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(index) = slot.as_ref() {
        return Arc::clone(index);
    }
    let mods = wfcd::cached_body("Mods");
    let arcanes = wfcd::cached_body("Arcanes");
    let built = Arc::new(Index::from_bodies(mods.as_deref(), arcanes.as_deref()));
    info!(
        target: "hexdesk::catalogue",
        items = built.len(),
        mods_stored = mods.is_some(),
        arcanes_stored = arcanes.is_some(),
        "item details indexed"
    );
    if !built.is_empty() {
        *slot = Some(Arc::clone(&built));
    }
    built
}

/// Drops the index, so the next call reads the files a catalogue rebuild
/// has just stored.
pub(crate) fn invalidate() {
    *INDEX.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Details of one mod or arcane; `None` for other items.
#[tauri::command]
pub(crate) async fn get_item_details(unique_name: String) -> Result<Option<ItemDetails>, String> {
    tauri::async_runtime::spawn_blocking(move || index().get(&unique_name).cloned())
        .await
        .map_err(|e| e.to_string())
}

/// Card facts (rarity, polarity, compatibility, augment) of every mod and
/// arcane, by unique name.
#[tauri::command]
pub(crate) async fn get_card_meta() -> Result<HashMap<String, CardMeta>, String> {
    tauri::async_runtime::spawn_blocking(|| index().card_metas())
        .await
        .map_err(|e| e.to_string())
}
