//! The app side of `hexdesk-player` (`src/backend/crates/player`): builds its
//! catalogue and inventory from the app state, keeps when the inventory was
//! last scanned and which rewards EE.log reported since, and serves the
//! Relic Reward cards.

use std::collections::HashMap;
use std::sync::Mutex;

use hexdesk_player::{catalogue_path, Catalogue, Inventory, Item, Millis, RecipeLine, RewardCard};
use tauri::Manager;

use crate::app_state::AppState;

/// When the last inventory scan was applied; None while the counts come from
/// the saved scan.
static SCAN_AT: Mutex<Option<Millis>> = Mutex::new(None);

/// Rewards EE.log reported since the last scan: when, which item, how many.
static REWARDS: Mutex<Vec<(Millis, String, i64)>> = Mutex::new(Vec::new());

/// Records that an inventory scan replaced the counts; it holds every reward
/// before it.
pub(crate) fn scan_applied() {
    *SCAN_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(crate::overlays::now());
    REWARDS.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// Records a reward EE.log reported, added to the counts.
pub(crate) fn reward_applied(path: &str, count: i64) {
    REWARDS.lock().unwrap_or_else(|e| e.into_inner()).push((
        crate::overlays::now(),
        path.to_string(),
        count,
    ));
}

/// The catalogue: every item, and the first level of each recipe.
pub(crate) fn catalogue(app: &tauri::AppHandle) -> Catalogue {
    let state = app.state::<AppState>();
    let items = state
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|i| Item {
            path: i.unique_name.clone(),
            name: i.name.clone(),
            category: i.category.clone(),
            vaulted: i.vaulted,
            ducats: i.ducats,
        })
        .collect();
    let recipes = state
        .recipes
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(built, lines)| {
            let lines = lines
                .iter()
                .map(|l| RecipeLine {
                    path: l.unique_name.clone(),
                    name: l.name.clone(),
                    count: l.count,
                })
                .collect();
            (built.clone(), lines)
        })
        .collect();
    Catalogue::new(items, recipes)
}

/// The inventory: counts of stackable and unique items, the rewards since the
/// last scan and Foundry jobs.
pub(crate) fn inventory(app: &tauri::AppHandle) -> Inventory {
    let state = app.state::<AppState>();
    let mut counts: HashMap<String, i64> = HashMap::new();
    for (path, &n) in state
        .current_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
    {
        *counts.entry(catalogue_path(path)).or_insert(0) += n;
    }
    for (path, &n) in state
        .unique_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
    {
        counts.entry(catalogue_path(path)).or_insert(n);
    }
    let mut crafting: HashMap<String, i64> = HashMap::new();
    for job in state
        .current_crafting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
    {
        *crafting
            .entry(catalogue_path(&job.unique_name))
            .or_insert(0) += 1;
    }
    Inventory {
        scan_at: *SCAN_AT.lock().unwrap_or_else(|e| e.into_inner()),
        counts,
        rewards: REWARDS.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        crafting,
    }
}

/// A time of day for log lines: "13:05:42".
pub(crate) fn time_of_day(at: Millis) -> String {
    chrono::DateTime::from_timestamp_millis(at)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|| at.to_string())
}

/// The Relic Reward cards for reward paths ("?:text" is OCR text that
/// matched no reward). Each card's counts and their sources are logged.
#[tauri::command]
pub(crate) fn get_reward_cards(app: tauri::AppHandle, paths: Vec<String>) -> Vec<RewardCard> {
    let catalogue = catalogue(&app);
    let inventory = inventory(&app);
    paths
        .iter()
        .map(|path| {
            if let Some(text) = path.strip_prefix("?:") {
                let mut card = hexdesk_player::sets::reward_card(&catalogue, &inventory, path);
                card.name = text.to_string();
                return card;
            }
            let card = hexdesk_player::sets::reward_card(&catalogue, &inventory, path);
            hexdesk_diag::info!(relic_reward, "Reward card: {}", card.explain(&time_of_day));
            card
        })
        .collect()
}
