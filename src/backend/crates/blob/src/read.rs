//! One reader per [`SectionKind`]. Each reader takes the section's value from
//! the blob and returns what it holds.

use crate::section_read::{SectionContent, SectionState};
use crate::sections::{Scalar, Section, SectionKind};
use crate::{
    compute_riven_mod_name, xp_to_rank, ArchonShard, BlobPendingRecipe, BlobRivenEntry,
    BlobRivenStat, BlobStackableEntry, BlobUniqueEntry, ModCount, RivenState,
};
use serde_json::Value;
use std::collections::HashMap;

const ARRAY: &str = "an array";

/// Reads one section. `value` is `None` when the blob does not have it.
pub(crate) fn read_section(section: &Section, value: Option<&Value>) -> SectionState {
    let Some(value) = value else {
        return SectionState::Missing;
    };
    let content = match section.kind {
        SectionKind::Scalar(scalar) => {
            let number = match scalar {
                // Mastery rank is never negative; a negative value is not a rank.
                Scalar::MasteryRank => value.as_u64().map(|v| v as i64),
                _ => value.as_i64(),
            };
            match number {
                Some(v) => SectionContent::Scalar(v),
                None => return unreadable("a number"),
            }
        }
        SectionKind::Unique => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut items = Vec::new();
            read_unique(arr, section.name, &mut items);
            SectionContent::Unique(items)
        }
        SectionKind::Stackable { sockets } => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut items = Vec::new();
            read_stackable(arr, sockets, &mut items);
            SectionContent::Stackable(items)
        }
        SectionKind::RawUpgrades | SectionKind::Upgrades => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut mods = HashMap::new();
            let mut rivens = Vec::new();
            if section.kind == SectionKind::RawUpgrades {
                read_raw_upgrades(arr, &mut mods, &mut rivens);
            } else {
                read_upgrades(arr, &mut mods, &mut rivens);
            }
            SectionContent::Upgrades { mods, rivens }
        }
        SectionKind::FlavourItems | SectionKind::WeaponSkins => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut counts = HashMap::new();
            read_occurrences(arr, &mut counts);
            SectionContent::Occurrences(counts)
        }
        SectionKind::Mastery => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut ranks = HashMap::new();
            read_mastery(arr, &mut ranks);
            SectionContent::Mastery(ranks)
        }
        SectionKind::PendingRecipes => {
            let Some(arr) = value.as_array() else {
                return unreadable(ARRAY);
            };
            let mut recipes = Vec::new();
            read_pending_recipes(arr, &mut recipes);
            SectionContent::PendingRecipes(recipes)
        }
        SectionKind::Helminth => {
            let Some(obj) = value.as_object() else {
                return unreadable("an object");
            };
            let mut suits = Vec::new();
            // A Helminth that has not consumed anything has no list.
            match obj.get("ConsumedSuits") {
                None => {}
                Some(list) => match list.as_array() {
                    Some(arr) => read_consumed_suits(arr, &mut suits),
                    None => return unreadable("an object with an array ConsumedSuits"),
                },
            }
            SectionContent::ConsumedSuits(suits)
        }
    };
    SectionState::Read(content)
}

fn unreadable(expected: &'static str) -> SectionState {
    SectionState::Unreadable { expected }
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
