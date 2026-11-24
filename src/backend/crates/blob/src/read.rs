//! One reader per [`SectionKind`]. Each reader takes the section's value from
//! the blob and adds what it holds to the inventory.

use crate::sections::{Scalar, Section, SectionKind};
use crate::{
    compute_riven_mod_name, xp_to_rank, ArchonShard, BlobInventory, BlobPendingRecipe,
    BlobRivenEntry, BlobRivenStat, BlobStackableEntry, BlobUniqueEntry, ModCount, RivenState,
};
use serde_json::Value;
use std::collections::HashMap;

/// Reads one section into `inv`. A section that is missing or has another
/// shape than its kind expects adds nothing.
pub(crate) fn read_section(section: &Section, value: &Value, inv: &mut BlobInventory) {
    match section.kind {
        SectionKind::Scalar(scalar) => read_scalar(scalar, value, inv),
        SectionKind::Unique => {
            if let Some(arr) = value.as_array() {
                read_unique(arr, section.name, &mut inv.unique_items);
            }
        }
        SectionKind::Stackable { sockets } => {
            if let Some(arr) = value.as_array() {
                read_stackable(arr, sockets, &mut inv.stackable_items);
            }
        }
        SectionKind::RawUpgrades => {
            if let Some(arr) = value.as_array() {
                read_raw_upgrades(arr, &mut inv.mods, &mut inv.rivens);
            }
        }
        SectionKind::Upgrades => {
            if let Some(arr) = value.as_array() {
                read_upgrades(arr, &mut inv.mods, &mut inv.rivens);
            }
        }
        SectionKind::FlavourItems => {
            if let Some(arr) = value.as_array() {
                read_occurrences(arr, &mut inv.flavour_items);
            }
        }
        SectionKind::WeaponSkins => {
            if let Some(arr) = value.as_array() {
                read_occurrences(arr, &mut inv.weapon_skins);
            }
        }
        SectionKind::Mastery => {
            if let Some(arr) = value.as_array() {
                read_mastery(arr, &mut inv.mastery_data);
            }
        }
        SectionKind::PendingRecipes => {
            if let Some(arr) = value.as_array() {
                read_pending_recipes(arr, &mut inv.pending_recipes);
            }
        }
        SectionKind::Helminth => {
            if let Some(arr) = value["ConsumedSuits"].as_array() {
                read_consumed_suits(arr, &mut inv.consumed_suits);
            }
        }
    }
}

fn read_scalar(scalar: Scalar, value: &Value, inv: &mut BlobInventory) {
    match scalar {
        Scalar::Credits => inv.credits = value.as_i64().unwrap_or(0),
        Scalar::Endo => inv.endo = value.as_i64().unwrap_or(0),
        Scalar::Platinum => inv.platinum = value.as_i64().unwrap_or(0),
        Scalar::FreePlatinum => inv.free_platinum = value.as_i64().unwrap_or(0),
        Scalar::MasteryRank => inv.mastery_level = value.as_u64().unwrap_or(0) as u32,
    }
}

/// The item path of an entry, when it is a game path.
fn lotus_item_type(e: &Value) -> Option<&str> {
    e["ItemType"]
        .as_str()
        .filter(|it| it.starts_with("/Lotus/"))
}

fn read_unique(arr: &[Value], section: &str, out: &mut Vec<BlobUniqueEntry>) {
    for e in arr {
        let Some(it) = lotus_item_type(e) else {
            continue;
        };
        let archon_shards = e["ArchonCrystalUpgrades"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|s| {
                        Some(ArchonShard {
                            color: s["Color"].as_str()?.to_string(),
                            upgrade_type: s["UpgradeType"].as_str().unwrap_or("").to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let modular_parts = e["ModularParts"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        out.push(BlobUniqueEntry {
            item_type: it.to_string(),
            section: section.to_string(),
            polarized: e["Polarized"].as_u64().unwrap_or(0) as u32,
            xp: e["XP"].as_i64().unwrap_or(0),
            item_name: e["ItemName"].as_str().map(String::from),
            pet_name: e["Details"]["Name"].as_str().map(String::from),
            focus_lens: e["FocusLens"].as_str().map(String::from),
            archon_shards,
            modular_parts,
        });
    }
}

fn read_stackable(arr: &[Value], sockets: bool, out: &mut Vec<BlobStackableEntry>) {
    for e in arr {
        let Some(it) = lotus_item_type(e) else {
            continue;
        };
        let count = e["ItemCount"].as_i64().unwrap_or(0);
        if count <= 0 {
            continue;
        }
        out.push(BlobStackableEntry {
            item_type: it.to_string(),
            item_count: count,
            sockets: if sockets { e["Sockets"].as_i64() } else { None },
        });
    }
}

/// Riven paths contain "RandomMod"; rivens are listed apart from the mods.
fn is_riven(item_type: &str) -> bool {
    item_type.contains("RandomMod")
}

fn read_raw_upgrades(
    arr: &[Value],
    mods: &mut HashMap<String, ModCount>,
    rivens: &mut Vec<BlobRivenEntry>,
) {
    for e in arr {
        let Some(it) = lotus_item_type(e) else {
            continue;
        };
        let count = e["ItemCount"].as_i64().unwrap_or(0);
        if count <= 0 {
            continue;
        }
        if is_riven(it) {
            // Unrevealed rivens are stacked here and show only their type.
            rivens.push(BlobRivenEntry {
                item_id: String::new(),
                item_type: it.to_string(),
                riven_state: RivenState::Unrevealed,
                compat: None,
                challenge_type: None,
                challenge_complication: None,
                lvl_req: None,
                polarity: None,
                buffs: vec![],
                curses: vec![],
                mod_rank: 0,
                count: count as u32,
                rerolls: 0,
                mod_name: String::new(),
            });
            continue;
        }
        let mc = mods.entry(it.to_string()).or_default();
        *mc.by_rank.entry(0).or_insert(0) += count;
        mc.total += count;
    }
}

fn read_upgrades(
    arr: &[Value],
    mods: &mut HashMap<String, ModCount>,
    rivens: &mut Vec<BlobRivenEntry>,
) {
    for e in arr {
        let Some(it) = lotus_item_type(e) else {
            continue;
        };
        if is_riven(it) {
            if let Some(riven) = read_riven(e, it) {
                rivens.push(riven);
                continue;
            }
        }
        let rank = mod_rank(e["UpgradeFingerprint"].as_str());
        let mc = mods.entry(it.to_string()).or_default();
        *mc.by_rank.entry(rank).or_insert(0) += 1;
        mc.total += 1;
    }
}

/// A revealed or unlocked riven from `Upgrades`. `None` when its fingerprint
/// says neither, so the entry counts as a plain mod.
fn read_riven(e: &Value, item_type: &str) -> Option<BlobRivenEntry> {
    let fp_str = e["UpgradeFingerprint"].as_str().unwrap_or("{}");
    let fp = serde_json::from_str::<Value>(fp_str).ok()?;
    let item_id = e["ItemId"]["$oid"].as_str().unwrap_or("").to_string();
    if let Some(compat) = fp["compat"].as_str() {
        // Unlocked: a weapon is assigned and the stats are visible.
        let buffs = riven_stats(&fp["buffs"]);
        let curses = riven_stats(&fp["curses"]);
        let mod_name = compute_riven_mod_name(&buffs);
        return Some(BlobRivenEntry {
            item_id,
            item_type: item_type.to_string(),
            riven_state: RivenState::Unlocked,
            compat: Some(compat.to_string()),
            challenge_type: None,
            challenge_complication: None,
            lvl_req: fp["lvlReq"].as_u64().map(|v| v as u32),
            polarity: fp["pol"].as_str().map(String::from),
            mod_rank: fp["lvl"].as_u64().map(|v| v as u8).unwrap_or(0),
            count: 1,
            rerolls: fp["rerolls"].as_u64().unwrap_or(0) as u32,
            mod_name,
            buffs,
            curses,
        });
    }
    if fp["challenge"].is_object() {
        // Revealed: the challenge is known but not yet completed.
        return Some(BlobRivenEntry {
            item_id,
            item_type: item_type.to_string(),
            riven_state: RivenState::Revealed,
            compat: None,
            challenge_type: fp["challenge"]["Type"].as_str().map(String::from),
            challenge_complication: fp["challenge"]["Complication"].as_str().map(String::from),
            lvl_req: None,
            polarity: None,
            buffs: vec![],
            curses: vec![],
            mod_rank: 0,
            count: 1,
            rerolls: 0,
            mod_name: String::new(),
        });
    }
    None
}

fn riven_stats(value: &Value) -> Vec<BlobRivenStat> {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    Some(BlobRivenStat {
                        tag: s["Tag"].as_str()?.to_string(),
                        value: s["Value"].as_i64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The `lvl` field of a mod's UpgradeFingerprint; 0 for an unranked mod or a
/// missing fingerprint.
fn mod_rank(fingerprint: Option<&str>) -> u8 {
    fingerprint
        .and_then(|fp| {
            let pos = fp.find("\"lvl\":")?;
            let after = fp[pos + 6..].trim_start();
            let end = after
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(after.len());
            after[..end].parse::<u8>().ok()
        })
        .unwrap_or(0)
}

/// Counts how often each item path occurs.
fn read_occurrences(arr: &[Value], out: &mut HashMap<String, i64>) {
    for e in arr {
        if let Some(it) = lotus_item_type(e) {
            *out.entry(it.to_string()).or_insert(0) += 1;
        }
    }
}

/// Mastery rank per item. Items at rank 0 are left out.
fn read_mastery(arr: &[Value], out: &mut HashMap<String, u32>) {
    for e in arr {
        let Some(it) = e["ItemType"].as_str() else {
            continue;
        };
        if let Some(xp) = e["XP"].as_i64() {
            let rank = xp_to_rank(xp, it);
            if rank > 0 {
                out.insert(it.to_string(), rank);
            }
        }
    }
}

fn read_pending_recipes(arr: &[Value], out: &mut Vec<BlobPendingRecipe>) {
    for e in arr {
        let Some(it) = e["ItemType"].as_str() else {
            continue;
        };
        // The game writes the time as a string or as a number.
        let date = &e["CompletionDate"]["$date"]["$numberLong"];
        let completion_ms = date
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .or_else(|| date.as_i64())
            .unwrap_or(0);
        out.push(BlobPendingRecipe {
            item_type: it.to_string(),
            completion_ms,
        });
    }
}

fn read_consumed_suits(arr: &[Value], out: &mut Vec<String>) {
    out.extend(arr.iter().filter_map(|e| e["s"].as_str().map(String::from)));
}
