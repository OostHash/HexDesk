use std::collections::HashMap;
use tauri::Manager;
use tracing::info;

use crate::app_state::AppState;

#[derive(serde::Serialize, Clone)]
struct RelicPickReward {
    name: String,
    rarity: String, // "Bronze" | "Silver" | "Gold"
    drop_rate: f64, // relic_drop_rate(rarity, refinement) for this relic
    ducats: u32,
    plat: u32,
    vaulted: bool,
    owned: bool,
}

#[derive(serde::Serialize, Clone)]
struct RelicPickRelic {
    name: String,       // "Lith A1 Intact"
    base_name: String,  // "Lith A1"
    refinement: String, // "intact" | "exceptional" | "flawless" | "radiant"
    count: i64,
    /// Whether the relic list on screen showed it; None when that is not
    /// known.
    on_screen: Option<bool>,
    unowned_score: f64,
    ducat_score: f64,
    plat_score: f64,
    rewards: Vec<RelicPickReward>,
}

fn relic_drop_rate(rarity: &str, refinement: &str) -> f64 {
    match (rarity, refinement) {
        ("Bronze", "intact") => 0.2533,
        ("Bronze", "exceptional") => 0.2333,
        ("Bronze", "flawless") => 0.20,
        ("Bronze", "radiant") => 0.1667,
        ("Silver", "intact") => 0.11,
        ("Silver", "exceptional") => 0.13,
        ("Silver", "flawless") => 0.17,
        ("Silver", "radiant") => 0.20,
        ("Gold", "intact") => 0.02,
        ("Gold", "exceptional") => 0.04,
        ("Gold", "flawless") => 0.06,
        ("Gold", "radiant") => 0.10,
        _ => 0.0,
    }
}

/// The names of every relic of an era as the relic list shows them, such as
/// "Meso V13"; every era for "ALL".
pub(crate) fn era_relic_names(era: &str, app: &tauri::AppHandle) -> Vec<String> {
    let prefix = era_prefix(era).unwrap_or("");
    let items = app
        .state::<AppState>()
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|i| i.category == "Relics" && i.name.starts_with(prefix))
        .filter_map(|i| i.name.rsplit_once(' ').map(|(base, _)| base.to_string()))
        .collect::<std::collections::BTreeSet<_>>();
    items.into_iter().collect()
}

/// The relics of an era the inventory says the player has, as the relic
/// list names them ("Meso V13").
pub(crate) fn owned_relic_names(era: &str, app: &tauri::AppHandle) -> Vec<String> {
    let prefix = era_prefix(era).unwrap_or("");
    let state = app.state::<AppState>();
    let quantities = state
        .current_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let names = state
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|i| i.category == "Relics" && i.name.starts_with(prefix))
        .filter(|i| quantities.get(&i.unique_name).is_some_and(|&q| q > 0))
        .filter_map(|i| i.name.rsplit_once(' ').map(|(base, _)| base.to_string()))
        .collect::<std::collections::BTreeSet<_>>();
    names.into_iter().collect()
}

/// The start of the relic names of an era ("Lith A1 Intact" starts with
/// "Lith "); empty for "ALL", None for an unknown era.
fn era_prefix(era: &str) -> Option<&'static str> {
    match era {
        "LITH" => Some("Lith "),
        "MESO" => Some("Meso "),
        "NEO" => Some("Neo "),
        "AXI" => Some("Axi "),
        "ALL" => Some(""),
        _ => None,
    }
}

/// How the relic list on screen changed a relic against the inventory, for
/// the log.
pub(crate) struct ScreenChange {
    pub relic: String,
    pub change: String,
}

/// Owned tiles that OCR did not identify. The collected counter is more
/// reliable than the number of tile names OCR found, so it also accounts for
/// tiles that OCR missed entirely.
fn unread_owned_tiles(list: &hexdesk_overlays::read::relic_list::RelicList) -> usize {
    let named_owned = list
        .tiles
        .iter()
        .filter(|tile| tile.owned == Some(true) && tile.relic.is_some())
        .count();
    list.collected.map_or_else(
        || {
            list.tiles
                .iter()
                .filter(|tile| tile.owned == Some(true) && tile.relic.is_none())
                .count()
        },
        |(owned, _)| (owned as usize).saturating_sub(named_owned),
    )
}

/// The Relic Pick payload: every relic of the era the player has, scored.
/// What the relic list on screen shows wins over the inventory, which the
/// game does not update during a mission: a faded tile leaves its relic out
/// and a count badge sets the count. On a list that is complete on screen, a
/// relic that is not shown is left out too, or, while some tiles could not
/// be named, kept and marked as not on screen. A tile never adds a relic the
/// inventory does not list: OCR misreads one relic as another.
pub(crate) fn build_relic_pick_payload(
    era: &str,
    app: &tauri::AppHandle,
    screen: Option<&hexdesk_overlays::read::relic_list::RelicList>,
) -> (serde_json::Value, Vec<ScreenChange>) {
    let state = app.state::<AppState>();
    let Some(era_prefix) = era_prefix(era) else {
        return (serde_json::json!({ "era": era, "relics": [] }), Vec::new());
    };
    let mut changes = Vec::new();

    let quantities = state
        .current_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    // relic_rewards is now keyed by display name ("Lith A1 Intact") after the wfcd.rs fix.
    let relic_rewards = state
        .relic_rewards
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let wfcd_items = state
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let plat_prices = state
        .relics_run_prices
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    info!(
        "relic-pick payload: quantities={} relic_rewards={} wfcd_items={} plat_prices={}",
        quantities.len(),
        relic_rewards.len(),
        wfcd_items.len(),
        plat_prices.len()
    );

    let ducat_map: HashMap<String, u32> = wfcd_items
        .iter()
        .filter_map(|item| item.ducats.map(|d| (item.name.to_lowercase(), d)))
        .collect();

    let vaulted_map: HashMap<String, bool> = wfcd_items
        .iter()
        .filter_map(|item| item.vaulted.map(|v| (item.name.to_lowercase(), v)))
        .collect();

    // A reward counts as owned when the player has it or an item built with
    // it; the rules live in src/backend/crates/player.
    let catalogue = crate::player::catalogue(app);
    let inventory = crate::player::inventory(app);
    let is_owned = |item_name: &str| -> bool {
        hexdesk_player::sets::has_item_or_build(&catalogue, &inventory, item_name)
    };

    // Refinement suffixes as they appear in display names (capitalised).
    const REFINEMENTS: &[(&str, &str)] = &[
        ("Intact", "intact"),
        ("Exceptional", "exceptional"),
        ("Flawless", "flawless"),
        ("Radiant", "radiant"),
    ];

    // Iterate wfcd_items for the relic catalog.
    // unique_name ("/Lotus/Upgrades/Relics/...") matches current_quantities keys from the blob.
    // Relics the inventory has at any refinement, as "Lith A1".
    let owned_bases: std::collections::HashSet<String> = wfcd_items
        .iter()
        .filter(|item| item.category == "Relics")
        .filter(|item| quantities.get(&item.unique_name).is_some_and(|&q| q > 0))
        .filter_map(|item| item.name.rsplit_once(' ').map(|(base, _)| base.to_string()))
        .collect();

    let mut relics: Vec<RelicPickRelic> = wfcd_items
        .iter()
        .filter(|item| item.category == "Relics")
        .filter(|item| era_prefix.is_empty() || item.name.starts_with(era_prefix))
        .filter_map(|item| {
            let in_inventory = *quantities.get(&item.unique_name).unwrap_or(&0);
            let (suffix_cap, refinement) = REFINEMENTS
                .iter()
                .find(|(cap, _)| item.name.ends_with(cap))?;
            let refinement = refinement.to_string();
            let base_name = item.name[..item.name.len() - suffix_cap.len() - 1].to_string();

            // When two tiles name this relic, OCR misread one of them; the
            // one the player has wins, so a misread can never remove a relic.
            let tile = screen.and_then(|list| {
                let mut named = list.tiles.iter().filter(|t| {
                    t.relic.as_deref() == Some(base_name.as_str())
                        && t.refinement.eq_ignore_ascii_case(&refinement)
                });
                let first = named.clone().next();
                named.find(|t| t.owned == Some(true)).or(first)
            });
            let complete = screen.is_some_and(|list| list.complete);
            let unread = screen.map_or(0, unread_owned_tiles);
            let mut on_screen = None;
            let (count, change) = match tile.and_then(|t| t.owned.map(|owned| (owned, t.count))) {
                Some((false, _)) => (
                    0,
                    (in_inventory > 0)
                        .then(|| format!("not owned on screen, inventory {in_inventory}")),
                ),
                // Refining moves a relic from one refinement to another, so a
                // relic the inventory has at another refinement is added.
                Some((true, badge)) if in_inventory <= 0 && owned_bases.contains(&base_name) => {
                    on_screen = Some(true);
                    let count = badge.map_or(1, i64::from);
                    (
                        count,
                        Some(format!(
                            "owned on screen; the inventory has it at another refinement: added, count {count}"
                        )),
                    )
                }
                Some((true, _)) if in_inventory <= 0 => (
                    0,
                    Some("owned on screen, not in inventory: not added".to_string()),
                ),
                Some((true, badge)) => {
                    on_screen = Some(true);
                    let count = badge.map_or(in_inventory, i64::from);
                    let change = (count != in_inventory)
                        .then(|| format!("count {count} on screen, inventory {in_inventory}"));
                    (count, change)
                }
                None if complete && in_inventory > 0 && unread == 0 => (
                    0,
                    Some(format!("not on the complete list on screen, inventory {in_inventory}")),
                ),
                None if complete && in_inventory > 0 => {
                    on_screen = Some(false);
                    (
                        in_inventory,
                        Some(format!(
                            "not confirmed on the complete list ({unread} owned tiles unread), inventory {in_inventory}: kept, marked not on screen"
                        )),
                    )
                }
                None => (in_inventory, None),
            };
            if let Some(change) = change {
                changes.push(ScreenChange {
                    relic: item.name.clone(),
                    change,
                });
            }
            if count <= 0 {
                return None;
            }

            // Rewards keyed by display name in relic_rewards (after wfcd.rs fix).
            let reward_list: Vec<RelicPickReward> = relic_rewards
                .get(&item.name)
                .map(|rewards| {
                    rewards
                        .iter()
                        .map(|r| {
                            let key = r.name.to_lowercase();
                            let drop_rate = relic_drop_rate(&r.rarity, &refinement);
                            let ducats = ducat_map.get(&key).copied().unwrap_or(0);
                            let plat = plat_prices.get(&key).copied().unwrap_or(0);
                            let vaulted = vaulted_map.get(&key).copied().unwrap_or(false);
                            let owned = is_owned(&r.name);
                            RelicPickReward {
                                name: r.name.clone(),
                                rarity: r.rarity.clone(),
                                drop_rate,
                                ducats,
                                plat,
                                vaulted,
                                owned,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            let unowned_score: f64 = reward_list
                .iter()
                .filter(|r| !r.owned)
                .map(|r| r.drop_rate)
                .sum();
            let ducat_score: f64 = reward_list
                .iter()
                .map(|r| r.drop_rate * r.ducats as f64)
                .sum();
            let plat_score: f64 = reward_list
                .iter()
                .map(|r| r.drop_rate * r.plat as f64)
                .sum();

            Some(RelicPickRelic {
                name: item.name.clone(),
                base_name,
                refinement,
                count,
                on_screen,
                unowned_score,
                ducat_score,
                plat_score,
                rewards: reward_list,
            })
        })
        .collect();

    relics.sort_by(|a, b| {
        b.ducat_score
            .partial_cmp(&a.ducat_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    info!(
        "relic-pick payload: {} relics built for era={}",
        relics.len(),
        era
    );
    (serde_json::json!({ "era": era, "relics": relics }), changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hexdesk_overlays::read::relic_list::{RelicList, RelicTile};

    fn tile(relic: Option<&str>) -> RelicTile {
        RelicTile {
            relic: relic.map(str::to_string),
            text: relic.unwrap_or("unread").to_string(),
            refinement: "Intact",
            owned: Some(true),
            count: None,
        }
    }

    #[test]
    fn collected_counter_includes_tiles_ocr_missed_entirely() {
        let list = RelicList {
            tiles: vec![
                tile(Some("Neo V12")),
                tile(Some("Neo T11")),
                tile(Some("Neo A16")),
                tile(Some("Neo K10")),
                tile(Some("Neo V13")),
                tile(Some("Neo Y2")),
                tile(None),
            ],
            collected: Some((8, 8)),
            complete: true,
        };

        assert_eq!(unread_owned_tiles(&list), 2);
    }
}
