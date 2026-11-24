use crate::read::read_section;
use crate::{extract_blob_json, find_blob_end, BlobInventory, BlobRead, SectionRead, SECTIONS};

/// `raw` must span from the JSON opening `{` (or from `"SubscribedToEmails"`) through
/// the closing brace after one of [`END_MARKERS`](crate::END_MARKERS). Returns `None` when
/// the blob is rejected; [`parse_full_account_blob_checked`] says why.
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
            BlobReject::MissingSection(s) => write!(f, "required section \"{s}\" is missing"),
            BlobReject::NoJsonStart => f.write_str("no JSON start found"),
            BlobReject::Json(e) => write!(f, "JSON could not be read: {e}"),
            BlobReject::NoItems => f.write_str("no Warframes or weapons in the blob"),
        }
    }
}

/// Like [`parse_full_account_blob`], but says why a blob was rejected.
#[tracing::instrument(target = "hexdesk::scanner", level = "debug", skip_all)]
pub fn parse_full_account_blob_checked(raw: &[u8]) -> Result<BlobInventory, BlobReject> {
    let mut inv = read_blob(raw)?.to_inventory();

    // Every valid FULL_ACCOUNT blob at the orbiter has at least one Warframe in Suits.
    // An empty unique_items means we captured an incomplete blob (game is mid-write,
    // returning from mission, or the blob sections were partially stitched out of order).
    if inv.unique_items.is_empty() {
        return Err(BlobReject::NoItems);
    }

    inv.content_hash = inv.compute_content_hash();
    Ok(inv)
}

/// Reads every section in [`SECTIONS`] from a blob. `raw` is the same as for
/// [`parse_full_account_blob`]. A section that is missing or unreadable is
/// reported as such; only a blob that is not an account blob at all, or that
/// lacks a core section, is rejected.
pub fn read_blob(raw: &[u8]) -> Result<BlobRead, BlobReject> {
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
    let search_range = &raw[..end_pos.min(raw.len())];
    for section in SECTIONS.iter().filter(|s| s.core) {
        let needle = format!("\"{}\":", section.name);
        if memchr::memmem::find(search_range, needle.as_bytes()).is_none() {
            return Err(BlobReject::MissingSection(section.name));
        }
    }

    let json_bytes = extract_blob_json(raw).ok_or(BlobReject::NoJsonStart)?;

    // The serde error names line and column only, never blob content.
    let json: serde_json::Value =
        serde_json::from_slice(&json_bytes).map_err(|e| BlobReject::Json(e.to_string()))?;

    let sections = SECTIONS
        .iter()
        .map(|section| SectionRead {
            section: *section,
            state: read_section(section, json.get(section.name)),
        })
        .collect();
    let keys = json
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    Ok(BlobRead { sections, keys })
}

#[cfg(test)]
mod tests {
    use super::{parse_full_account_blob, parse_full_account_blob_checked, read_blob, BlobReject};
    use crate::{SectionContent, SectionState};

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
            BlobReject::MissingSection("MiscItems")
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

    /// The body of a blob with every section the parser reads.
    fn full_account_json() -> serde_json::Value {
        serde_json::json!({
            "SubscribedToEmails": 0,
            "RegularCredits": 1234,
            "FusionPoints": 500,
            "PremiumCredits": 90,
            "PremiumCreditsFree": 40,
            "PlayerLevel": 12,
            "XPInfo": [
                {"ItemType": "/Lotus/Powersuits/Excalibur/Excalibur", "XP": 900_000},
                {"ItemType": "/Lotus/Weapons/Tenno/Rifle/Soma", "XP": 2000},
                {"ItemType": "/Lotus/Weapons/Tenno/Pistol/Lato", "XP": 100}
            ],
            "Suits": [
                {
                    "ItemType": "/Lotus/Powersuits/Excalibur/Excalibur",
                    "XP": 900_000,
                    "Polarized": 2,
                    "FocusLens": "/Lotus/Upgrades/Focus/PowerLens",
                    "ArchonCrystalUpgrades": [
                        {"Color": "ACC_CRIMSON", "UpgradeType": "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeStrength"},
                        {"UpgradeType": "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/NoColour"}
                    ]
                },
                {"ItemType": "NotALotusPath"}
            ],
            "OperatorAmps": [
                {"ItemType": "/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorAmpWeapon", "ModularParts": ["/Lotus/Weapons/Operator/Pistols/DrifterPistol/Prism"]}
            ],
            "KubrowPets": [
                {"ItemType": "/Lotus/Types/Game/KubrowPet/FurtivePetPowerSuit", "Details": {"Name": "Rex"}}
            ],
            "LongGuns": [
                {"ItemType": "/Lotus/Weapons/Tenno/Rifle/Soma", "XP": 2000, "ItemName": "Gilded"}
            ],
            "ShipDecorations": [{"ItemType": "/Lotus/Types/Items/ShipDecos/Deco", "ItemCount": 1}],
            "FusionTreasures": [{"ItemType": "/Lotus/Types/Items/FusionTreasures/Sculpture", "ItemCount": 2, "Sockets": 3}],
            "Recipes": [{"ItemType": "/Lotus/Types/Recipes/Weapons/SomaBlueprint", "ItemCount": 1}],
            "MiscItems": [
                {"ItemType": "/Lotus/Types/Items/MiscItems/Alloy", "ItemCount": 100},
                {"ItemType": "/Lotus/Types/Items/MiscItems/Used", "ItemCount": 0}
            ],
            "RawUpgrades": [
                {"ItemType": "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod", "ItemCount": 3},
                {"ItemType": "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod", "ItemCount": 2}
            ],
            "Upgrades": [
                {"ItemType": "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod", "UpgradeFingerprint": "{\"lvl\":5}"},
                {"ItemType": "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod"},
                {
                    "ItemType": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
                    "ItemId": {"$oid": "unlocked1"},
                    "UpgradeFingerprint": "{\"compat\":\"/Lotus/Weapons/Tenno/Rifle/Soma\",\"lvlReq\":10,\"pol\":\"AP_ATTACK\",\"lvl\":8,\"rerolls\":3,\"buffs\":[{\"Tag\":\"WeaponCritChanceMod\",\"Value\":900},{\"Tag\":\"WeaponCritDamageMod\",\"Value\":500}],\"curses\":[{\"Tag\":\"WeaponZoomFovMod\",\"Value\":100}]}"
                },
                {
                    "ItemType": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
                    "ItemId": {"$oid": "revealed1"},
                    "UpgradeFingerprint": "{\"challenge\":{\"Type\":\"/Lotus/Types/Challenges/Headshots\",\"Complication\":\"/Lotus/Types/Challenges/Complications/Solo\"}}"
                }
            ],
            "FlavourItems": [
                {"ItemType": "/Lotus/Types/StoreItems/AvatarImages/GlyphA"},
                {"ItemType": "/Lotus/Types/StoreItems/AvatarImages/GlyphA"},
                {"ItemType": "/Lotus/Types/StoreItems/Palettes/PaletteB"}
            ],
            "WeaponSkins": [{"ItemType": "/Lotus/Upgrades/Skins/Sigils/SigilC"}],
            "PendingRecipes": [
                {"ItemType": "/Lotus/Types/Recipes/Weapons/LatoBlueprint", "CompletionDate": {"$date": {"$numberLong": "1700000000000"}}},
                {"ItemType": "/Lotus/Types/Recipes/Weapons/BratonBlueprint", "CompletionDate": {"$date": {"$numberLong": 1_700_000_000_001_i64}}}
            ],
            "InfestedFoundry": {"ConsumedSuits": [{"s": "/Lotus/Powersuits/Mag/Mag"}]}
        })
    }

    /// A blob from `body`, with padding and the end marker put last.
    fn blob_from(body: &serde_json::Value) -> Vec<u8> {
        let mut s = body.to_string();
        s.pop();
        s.push_str(&format!(
            r#","_pad":"{}","DeathSquadable":false}}"#,
            "x".repeat(60_000)
        ));
        s.into_bytes()
    }

    #[test]
    fn every_section_is_read_into_the_inventory() {
        let inv = parse_full_account_blob(&blob_from(&full_account_json()))
            .expect("full account must parse");
        let mut got = serde_json::to_value(&inv).unwrap();
        let obj = got.as_object_mut().unwrap();
        obj.remove("sections");
        obj.remove("content_hash");
        let expected = serde_json::json!({
            "credits": 1234,
            "endo": 500,
            "platinum": 90,
            "free_platinum": 40,
            "mastery_level": 12,
            "unique_items": [
                {
                    "item_type": "/Lotus/Powersuits/Excalibur/Excalibur",
                    "section": "Suits",
                    "polarized": 2,
                    "xp": 900_000,
                    "item_name": null,
                    "pet_name": null,
                    "focus_lens": "/Lotus/Upgrades/Focus/PowerLens",
                    "archon_shards": [{"upgrade_type": "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeStrength", "color": "ACC_CRIMSON"}]
                },
                {
                    "item_type": "/Lotus/Weapons/Tenno/Rifle/Soma",
                    "section": "LongGuns",
                    "polarized": 0,
                    "xp": 2000,
                    "item_name": "Gilded",
                    "pet_name": null,
                    "focus_lens": null,
                    "archon_shards": []
                },
                {
                    "item_type": "/Lotus/Types/Game/KubrowPet/FurtivePetPowerSuit",
                    "section": "KubrowPets",
                    "polarized": 0,
                    "xp": 0,
                    "item_name": null,
                    "pet_name": "Rex",
                    "focus_lens": null,
                    "archon_shards": []
                },
                {
                    "item_type": "/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorAmpWeapon",
                    "section": "OperatorAmps",
                    "polarized": 0,
                    "xp": 0,
                    "item_name": null,
                    "pet_name": null,
                    "focus_lens": null,
                    "archon_shards": [],
                    "modular_parts": ["/Lotus/Weapons/Operator/Pistols/DrifterPistol/Prism"]
                }
            ],
            "stackable_items": [
                {"item_type": "/Lotus/Types/Items/MiscItems/Alloy", "item_count": 100, "sockets": null},
                {"item_type": "/Lotus/Types/Recipes/Weapons/SomaBlueprint", "item_count": 1, "sockets": null},
                {"item_type": "/Lotus/Types/Items/FusionTreasures/Sculpture", "item_count": 2, "sockets": 3},
                {"item_type": "/Lotus/Types/Items/ShipDecos/Deco", "item_count": 1, "sockets": null}
            ],
            "mods": {
                "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod": {"total": 5, "by_rank": {"0": 4, "5": 1}}
            },
            "flavour_items": {
                "/Lotus/Types/StoreItems/AvatarImages/GlyphA": 2,
                "/Lotus/Types/StoreItems/Palettes/PaletteB": 1
            },
            "weapon_skins": {"/Lotus/Upgrades/Skins/Sigils/SigilC": 1},
            "mastery_data": {
                "/Lotus/Powersuits/Excalibur/Excalibur": 30,
                "/Lotus/Weapons/Tenno/Rifle/Soma": 2
            },
            "pending_recipes": [
                {"item_type": "/Lotus/Types/Recipes/Weapons/LatoBlueprint", "completion_ms": 1_700_000_000_000_i64},
                {"item_type": "/Lotus/Types/Recipes/Weapons/BratonBlueprint", "completion_ms": 1_700_000_000_001_i64}
            ],
            "consumed_suits": ["/Lotus/Powersuits/Mag/Mag"],
            "rivens": [
                {
                    "item_id": "",
                    "item_type": "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod",
                    "riven_state": "unrevealed",
                    "compat": null,
                    "challenge_type": null,
                    "challenge_complication": null,
                    "lvl_req": null,
                    "polarity": null,
                    "buffs": [],
                    "curses": [],
                    "mod_rank": 0,
                    "count": 2,
                    "rerolls": 0
                },
                {
                    "item_id": "unlocked1",
                    "item_type": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
                    "riven_state": "unlocked",
                    "compat": "/Lotus/Weapons/Tenno/Rifle/Soma",
                    "challenge_type": null,
                    "challenge_complication": null,
                    "lvl_req": 10,
                    "polarity": "AP_ATTACK",
                    "buffs": [
                        {"tag": "WeaponCritChanceMod", "value": 900},
                        {"tag": "WeaponCritDamageMod", "value": 500}
                    ],
                    "curses": [{"tag": "WeaponZoomFovMod", "value": 100}],
                    "mod_rank": 8,
                    "count": 1,
                    "rerolls": 3,
                    "mod_name": "critatis"
                },
                {
                    "item_id": "revealed1",
                    "item_type": "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
                    "riven_state": "revealed",
                    "compat": null,
                    "challenge_type": "/Lotus/Types/Challenges/Headshots",
                    "challenge_complication": "/Lotus/Types/Challenges/Complications/Solo",
                    "lvl_req": null,
                    "polarity": null,
                    "buffs": [],
                    "curses": [],
                    "mod_rank": 0,
                    "count": 1,
                    "rerolls": 0
                }
            ]
        });
        assert_eq!(got, expected);
    }

    fn state<'a>(read: &'a crate::BlobRead, name: &str) -> &'a SectionState {
        &read
            .sections
            .iter()
            .find(|s| s.section.name == name)
            .expect("section is in the table")
            .state
    }

    #[test]
    fn every_section_in_a_full_blob_is_read() {
        let read = read_blob(&blob_from(&full_account_json())).unwrap();
        assert_eq!(read.sections.len(), crate::SECTIONS.len());
        let not_read: Vec<&str> = read
            .sections
            .iter()
            .filter(|s| !matches!(s.state, SectionState::Read(_)))
            .map(|s| s.section.name)
            .collect();
        // The blob leaves out the unique sections it has no items for and
        // CrewShipRawSalvage.
        assert_eq!(
            not_read,
            [
                "Pistols",
                "Melee",
                "SpaceSuits",
                "SpaceMelee",
                "SpaceGuns",
                "Sentinels",
                "SentinelWeapons",
                "MechSuits",
                "CrewShipRawSalvage"
            ]
        );
        assert!(not_read
            .iter()
            .all(|name| matches!(state(&read, name), SectionState::Missing)));
    }

    #[test]
    fn a_missing_section_is_reported_and_the_others_are_read() {
        let mut body = full_account_json();
        body.as_object_mut().unwrap().remove("Recipes");
        let read = read_blob(&blob_from(&body)).unwrap();
        assert!(matches!(state(&read, "Recipes"), SectionState::Missing));
        assert!(matches!(
            state(&read, "MiscItems"),
            SectionState::Read(SectionContent::Stackable(items)) if items.len() == 1
        ));
        assert!(!read.keys.iter().any(|k| k == "Recipes"));
    }

    #[test]
    fn a_section_with_another_shape_is_unreadable_and_the_others_are_read() {
        let mut body = full_account_json();
        body["Recipes"] = serde_json::json!({"ItemType": "/Lotus/Types/Recipes/X"});
        body["FusionPoints"] = serde_json::json!("many");
        body["InfestedFoundry"] = serde_json::json!({"ConsumedSuits": 3});
        let read = read_blob(&blob_from(&body)).unwrap();
        assert!(matches!(
            state(&read, "Recipes"),
            SectionState::Unreadable {
                expected: "an array"
            }
        ));
        assert!(matches!(
            state(&read, "FusionPoints"),
            SectionState::Unreadable {
                expected: "a number"
            }
        ));
        assert!(matches!(
            state(&read, "InfestedFoundry"),
            SectionState::Unreadable { .. }
        ));
        assert!(matches!(
            state(&read, "RegularCredits"),
            SectionState::Read(SectionContent::Scalar(1234))
        ));

        // The inventory gets nothing from them, as for a missing section.
        let inv = read.to_inventory();
        assert_eq!(inv.endo, 0);
        assert!(inv.consumed_suits.is_empty());
        assert!(!inv
            .stackable_items
            .iter()
            .any(|e| e.item_type.contains("/Recipes/")));
    }

    #[test]
    fn a_helminth_without_consumed_suits_is_read_as_empty() {
        let mut body = full_account_json();
        body["InfestedFoundry"] = serde_json::json!({});
        let read = read_blob(&blob_from(&body)).unwrap();
        assert!(matches!(
            state(&read, "InfestedFoundry"),
            SectionState::Read(SectionContent::ConsumedSuits(suits)) if suits.is_empty()
        ));
    }

    #[test]
    fn each_upgrade_section_keeps_its_own_share_of_a_mod() {
        const SERRATION: &str = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";
        let read = read_blob(&blob_from(&full_account_json())).unwrap();
        let share = |name: &str| match state(&read, name) {
            SectionState::Read(SectionContent::Upgrades { mods, .. }) => mods[SERRATION].total,
            other => panic!("{name} was not read: {other:?}"),
        };
        assert_eq!(share("RawUpgrades"), 3);
        assert_eq!(share("Upgrades"), 2);
        assert_eq!(read.to_inventory().mods[SERRATION].total, 5);
    }

    #[test]
    fn a_blob_without_items_is_read_but_not_turned_into_an_inventory() {
        let mut body = full_account_json();
        for name in ["Suits", "LongGuns", "KubrowPets", "OperatorAmps"] {
            body[name] = serde_json::json!([]);
        }
        let raw = blob_from(&body);
        assert!(read_blob(&raw).is_ok());
        assert_eq!(
            parse_full_account_blob_checked(&raw).unwrap_err(),
            BlobReject::NoItems
        );
    }
}
