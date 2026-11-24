use crate::{
    compute_riven_mod_name, extract_blob_json, find_blob_end, xp_to_rank, ArchonShard,
    BlobInventory, BlobPendingRecipe, BlobRivenEntry, BlobRivenStat, BlobStackableEntry,
    BlobUniqueEntry, ModCount, RivenState,
};
use std::collections::HashMap;

/// `raw` must span from the JSON opening `{` (or from `"SubscribedToEmails"`) through
/// `"DeathSquadable":`. Returns `None` if neither start can be located or JSON is malformed.
pub fn parse_full_account_blob(raw: &[u8]) -> Option<BlobInventory> {
    parse_full_account_blob_checked(raw).ok()
}

/// Why a candidate blob was not accepted. Logged as the cause when no
/// candidate in a capture pass could be read.
#[derive(Debug, Clone, PartialEq)]
pub enum BlobReject {
    NoEnd,
    TooSmall { bytes: usize, min: usize },
    MissingSection(&'static str),
    NoJsonStart,
    Json(String),
    NoItems,
}

impl std::fmt::Display for BlobReject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlobReject::NoEnd => f.write_str("no end marker"),
            BlobReject::TooSmall { bytes, min } => {
                write!(f, "{bytes} bytes, below the {min}-byte minimum")
            }
            BlobReject::MissingSection(s) => write!(f, "required section {s} is missing"),
            BlobReject::NoJsonStart => f.write_str("no JSON start found"),
            BlobReject::Json(e) => write!(f, "JSON could not be read: {e}"),
            BlobReject::NoItems => f.write_str("no Warframes or weapons in the blob"),
        }
    }
}

/// Like [`parse_full_account_blob`], but says why a blob was rejected.
#[tracing::instrument(target = "hexdesk::scanner", level = "debug", skip_all)]
pub fn parse_full_account_blob_checked(raw: &[u8]) -> Result<BlobInventory, BlobReject> {
    let end_pos = find_blob_end(raw).ok_or(BlobReject::NoEnd)?;

    // Real FULL_ACCOUNT blobs are several hundred KB — anything smaller is a
    // small false-positive fragment that matched the end marker by coincidence.
    const MIN_PARSE_BYTES: usize = 50_000;
    if end_pos < MIN_PARSE_BYTES {
        return Err(BlobReject::TooSmall {
            bytes: end_pos,
            min: MIN_PARSE_BYTES,
        });
    }

    // Section completeness check: field order varies per account, so the true
    // outer `{` of the blob can sit in a memory region the stitcher never
    // recovered — the resulting seed still parses as valid JSON, just starting
    // mid-object (e.g. right at SubscribedToEmails) and silently missing every
    // top-level section that came before it.
    //
    // Which optional sections exist differs per account, so this is only a
    // small universal core that every real account has. The per-account check
    // ("a section the last good blob had is now gone") is up to the caller,
    // using `BlobInventory::sections`.
    const CORE_SECTIONS: &[&[u8]] = &[
        b"\"RegularCredits\":",
        b"\"PlayerLevel\":",
        b"\"XPInfo\":",
        b"\"Suits\":",
        b"\"MiscItems\":",
        b"\"RawUpgrades\":",
    ];
    let search_range = &raw[..end_pos.min(raw.len())];
    for required in CORE_SECTIONS {
        if memchr::memmem::find(search_range, required).is_none() {
            let name = std::str::from_utf8(required).unwrap_or("?");
            return Err(BlobReject::MissingSection(name.trim_end_matches(':')));
        }
    }

    let json_bytes = extract_blob_json(raw).ok_or(BlobReject::NoJsonStart)?;

    // The serde error names line and column only, never blob content.
    let json: serde_json::Value =
        serde_json::from_slice(&json_bytes).map_err(|e| BlobReject::Json(e.to_string()))?;

    // Scalars
    let credits = json["RegularCredits"].as_i64().unwrap_or(0);
    let endo = json["FusionPoints"].as_i64().unwrap_or(0);
    let platinum = json["PremiumCredits"].as_i64().unwrap_or(0);
    let free_platinum = json["PremiumCreditsFree"].as_i64().unwrap_or(0);
    let mastery_level = json["PlayerLevel"].as_u64().unwrap_or(0) as u32;

    // Unique item sections — each array entry = one owned copy
    const UNIQUE_SECS: &[&str] = &[
        "Suits",
        "LongGuns",
        "Pistols",
        "Melee",
        "SpaceSuits",
        "SpaceMelee",
        "SpaceGuns",
        "Sentinels",
        "SentinelWeapons",
        "KubrowPets",
        "OperatorAmps",
        "MechSuits",
    ];
    let mut unique_items = Vec::new();
    for &sec in UNIQUE_SECS {
        if let Some(arr) = json[sec].as_array() {
            for e in arr {
                let Some(it) = e["ItemType"].as_str() else {
                    continue;
                };
                if !it.starts_with("/Lotus/") {
                    continue;
                }
                let archon_shards = e["ArchonCrystalUpgrades"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| {
                                Some(ArchonShard {
                                    color: s["Color"].as_str()?.to_string(),
                                    upgrade_type: s["UpgradeType"]
                                        .as_str()
                                        .unwrap_or("")
                                        .to_string(),
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
                unique_items.push(BlobUniqueEntry {
                    item_type: it.to_string(),
                    section: sec.to_string(),
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
    }

    // Stackable item sections
    const STACK_SECS: &[(&str, bool)] = &[
        ("MiscItems", false),
        ("Recipes", false),
        ("FusionTreasures", true), // has Sockets
        ("CrewShipRawSalvage", false),
        ("ShipDecorations", false),
    ];
    let mut stackable_items = Vec::new();
    for &(sec, has_sockets) in STACK_SECS {
        if let Some(arr) = json[sec].as_array() {
            for e in arr {
                let Some(it) = e["ItemType"].as_str() else {
                    continue;
                };
                if !it.starts_with("/Lotus/") {
                    continue;
                }
                let count = e["ItemCount"].as_i64().unwrap_or(0);
                if count <= 0 {
                    continue;
                }
                stackable_items.push(BlobStackableEntry {
                    item_type: it.to_string(),
                    item_count: count,
                    sockets: if has_sockets {
                        e["Sockets"].as_i64()
                    } else {
                        None
                    },
                });
            }
        }
    }

    // Rivens + Mods: RawUpgrades (unranked, ItemCount) + Upgrades (ranked, one entry = one copy).
    // Riven paths contain "RandomMod" — extract them separately and skip from mods map.
    let mut rivens: Vec<BlobRivenEntry> = Vec::new();
    let mut mods: HashMap<String, ModCount> = HashMap::new();
    if let Some(arr) = json["RawUpgrades"].as_array() {
        for e in arr {
            let Some(it) = e["ItemType"].as_str() else {
                continue;
            };
            if !it.starts_with("/Lotus/") {
                continue;
            }
            let count = e["ItemCount"].as_i64().unwrap_or(0);
            if count <= 0 {
                continue;
            }
            if it.contains("RandomMod") {
                // Unrevealed riven: stacked in RawUpgrades, only type visible.
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
    if let Some(arr) = json["Upgrades"].as_array() {
        for e in arr {
            let Some(it) = e["ItemType"].as_str() else {
                continue;
            };
            if !it.starts_with("/Lotus/") {
                continue;
            }
            if it.contains("RandomMod") {
                let fp_str = e["UpgradeFingerprint"].as_str().unwrap_or("{}");
                if let Ok(fp) = serde_json::from_str::<serde_json::Value>(fp_str) {
                    let item_id = e["ItemId"]["$oid"].as_str().unwrap_or("").to_string();
                    if let Some(compat) = fp["compat"].as_str() {
                        // Unlocked riven: weapon assigned + stats visible.
                        let buffs: Vec<BlobRivenStat> = fp["buffs"]
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
                            .unwrap_or_default();
                        let curses: Vec<BlobRivenStat> = fp["curses"]
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
                            .unwrap_or_default();
                        let mod_name = compute_riven_mod_name(&buffs);
                        rivens.push(BlobRivenEntry {
                            item_id,
                            item_type: it.to_string(),
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
                        continue;
                    } else if fp["challenge"].is_object() {
                        // Revealed riven: challenge assigned but not yet completed.
                        let challenge_type = fp["challenge"]["Type"].as_str().map(String::from);
                        let challenge_complication =
                            fp["challenge"]["Complication"].as_str().map(String::from);
                        rivens.push(BlobRivenEntry {
                            item_id,
                            item_type: it.to_string(),
                            riven_state: RivenState::Revealed,
                            compat: None,
                            challenge_type,
                            challenge_complication,
                            lvl_req: None,
                            polarity: None,
                            buffs: vec![],
                            curses: vec![],
                            mod_rank: 0,
                            count: 1,
                            rerolls: 0,
                            mod_name: String::new(),
                        });
                        continue;
                    }
                }
            }
            let rank = blob_extract_mod_rank(e["UpgradeFingerprint"].as_str());
            let mc = mods.entry(it.to_string()).or_default();
            *mc.by_rank.entry(rank).or_insert(0) += 1;
            mc.total += 1;
        }
    }

    // FlavourItems (glyphs, palettes, emotes, titles, ship skins): each entry = one copy.
    let mut flavour_items: HashMap<String, i64> = HashMap::new();
    if let Some(arr) = json["FlavourItems"].as_array() {
        for e in arr {
            let Some(it) = e["ItemType"].as_str() else {
                continue;
            };
            if !it.starts_with("/Lotus/") {
                continue;
            }
            *flavour_items.entry(it.to_string()).or_insert(0) += 1;
        }
    }

    // WeaponSkins (sigils, cosmetic skins): each array entry = one owned copy,
    // count occurrences of the same ItemType.
    let mut weapon_skins: HashMap<String, i64> = HashMap::new();
    if let Some(arr) = json["WeaponSkins"].as_array() {
        for e in arr {
            let Some(it) = e["ItemType"].as_str() else {
                continue;
            };
            if !it.starts_with("/Lotus/") {
                continue;
            }
            *weapon_skins.entry(it.to_string()).or_insert(0) += 1;
        }
    }

    // XPInfo → mastery ranks (covers items no longer owned)
    let mut mastery_data: HashMap<String, u32> = HashMap::new();
    if let Some(arr) = json["XPInfo"].as_array() {
        for e in arr {
            let Some(it) = e["ItemType"].as_str() else {
                continue;
            };
            if let Some(xp) = e["XP"].as_i64() {
                let rank = xp_to_rank(xp, it);
                if rank > 0 {
                    mastery_data.insert(it.to_string(), rank);
                }
            }
        }
    }

    // PendingRecipes (Foundry)
    let pending_recipes: Vec<BlobPendingRecipe> = json["PendingRecipes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| {
                    let it = e["ItemType"].as_str()?.to_string();
                    let ms = e["CompletionDate"]["$date"]["$numberLong"]
                        .as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                        .or_else(|| e["CompletionDate"]["$date"]["$numberLong"].as_i64())
                        .unwrap_or(0);
                    Some(BlobPendingRecipe {
                        item_type: it,
                        completion_ms: ms,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Helminth consumed suits
    let consumed_suits: Vec<String> = json["InfestedFoundry"]["ConsumedSuits"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| e["s"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // Every valid FULL_ACCOUNT blob at the orbiter has at least one Warframe in Suits.
    // An empty unique_items means we captured an incomplete blob (game is mid-write,
    // returning from mission, or the blob sections were partially stitched out of order).
    if unique_items.is_empty() {
        return Err(BlobReject::NoItems);
    }

    let sections: Vec<String> = json
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    let mut inv = BlobInventory {
        credits,
        endo,
        platinum,
        free_platinum,
        mastery_level,
        unique_items,
        stackable_items,
        mods,
        flavour_items,
        weapon_skins,
        mastery_data,
        pending_recipes,
        consumed_suits,
        rivens,
        sections,
        content_hash: 0,
    };
    inv.content_hash = inv.compute_content_hash();
    Ok(inv)
}

/// Extract the `lvl` field from a mod UpgradeFingerprint JSON string.
/// Returns 0 for unranked or missing fingerprint.
fn blob_extract_mod_rank(fingerprint: Option<&str>) -> u8 {
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

#[cfg(test)]
mod tests {
    use super::{parse_full_account_blob, parse_full_account_blob_checked, BlobReject};

    /// Account with only the core sections: no Sentinels, KubrowPets,
    /// MechSuits and so on. `extra` goes in before the padding.
    fn account_blob(extra: &str, suits: &str) -> String {
        let padding = "x".repeat(60_000);
        format!(
            r#"{{"SubscribedToEmails":0,"RegularCredits":5,"PlayerLevel":3,"XPInfo":[],
"Suits":[{suits}],"MiscItems":[],"RawUpgrades":[],{extra}
"_pad":"{padding}","DeathSquadable":false}}"#
        )
    }

    const SUIT: &str = r#"{"ItemType":"/Lotus/Powersuits/Test/Test"}"#;

    fn minimal_account_blob() -> Vec<u8> {
        account_blob("", SUIT).into_bytes()
    }

    #[test]
    fn account_without_optional_sections_is_accepted() {
        let inv =
            parse_full_account_blob(&minimal_account_blob()).expect("core-only account must parse");
        assert_eq!(inv.credits, 5);
        assert!(inv.sections.iter().any(|s| s == "Suits"));
        assert!(!inv.sections.iter().any(|s| s == "Sentinels"));
    }

    #[test]
    fn identical_blobs_hash_equal_and_changed_content_differs() {
        let a = parse_full_account_blob(&minimal_account_blob()).unwrap();
        let b = parse_full_account_blob(&minimal_account_blob()).unwrap();
        assert_ne!(a.content_hash, 0);
        assert_eq!(a.content_hash, b.content_hash);

        let changed = String::from_utf8(minimal_account_blob())
            .unwrap()
            .replace("\"RegularCredits\":5", "\"RegularCredits\":6");
        let c = parse_full_account_blob(changed.as_bytes()).unwrap();
        assert_ne!(a.content_hash, c.content_hash);
    }

    #[test]
    fn blob_missing_a_core_section_is_rejected() {
        let s = String::from_utf8(minimal_account_blob())
            .unwrap()
            .replace("\"MiscItems\":[],", "");
        assert!(parse_full_account_blob(s.as_bytes()).is_none());
    }

    #[test]
    fn parser_names_the_reason_for_each_rejection() {
        assert_eq!(
            parse_full_account_blob_checked(b"{\"a\":1}").unwrap_err(),
            BlobReject::NoEnd
        );
        assert!(matches!(
            parse_full_account_blob_checked(br#"{"SubscribedToEmails":0,"DeathSquadable":false}"#),
            Err(BlobReject::TooSmall { min: 50_000, .. })
        ));
        let no_misc = account_blob("", SUIT).replace("\"MiscItems\":[],", "");
        assert_eq!(
            parse_full_account_blob_checked(no_misc.as_bytes()).unwrap_err(),
            BlobReject::MissingSection("\"MiscItems\"")
        );
        let no_suits = account_blob("", "");
        assert_eq!(
            parse_full_account_blob_checked(no_suits.as_bytes()).unwrap_err(),
            BlobReject::NoItems
        );
        let broken = account_blob(r#""Broken":[1,,2],"#, SUIT);
        assert!(matches!(
            parse_full_account_blob_checked(broken.as_bytes()),
            Err(BlobReject::Json(_))
        ));
    }

    #[test]
    fn rejection_reasons_contain_no_blob_content() {
        let broken = account_blob(r#""Secret":"abc"x,"#, SUIT);
        let reason = parse_full_account_blob_checked(broken.as_bytes())
            .unwrap_err()
            .to_string();
        assert!(reason.starts_with("JSON could not be read:"), "{reason}");
        assert!(!reason.contains("abc"), "{reason}");
    }
}
