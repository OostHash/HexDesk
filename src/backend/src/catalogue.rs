use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tracing::info;

use crate::app_state::AppState;
use crate::events;
use crate::inventory_state::{persist_inventory_state_cache, CachedItem};
use crate::memory_scanner;
use crate::wfcd::{RecipeComponent, WfcdItem};
use crate::{cache, wfcd};

use crate::monitor::CraftingJob;

// ─── Item catalog ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
pub struct CatalogItem {
    pub unique_name: String,
    pub name: String,
    pub category: String,
    pub image_name: Option<String>,
    pub vaulted: Option<bool>,
    pub ducats: Option<u32>,
    pub mastery_req: Option<u32>,
    pub max_level_cap: Option<u32>,
    /// Whether levelling this item grants mastery XP (from WFCD).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masterable: Option<bool>,
    /// Explicit tradeability flag from corrections.json. `Some(false)` = not on WFM.
    /// `None` = auto-detected from ducat_price / category (the normal case for WFCD items).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tradeable_wfm: Option<bool>,
    /// Set on non-craftable weapon items returned by get_craftable_items.
    /// Values: "kuva_lich", "sister", "baro", "duviri", "event", "amp", "zaw", "acquired".
    /// None = craftable (has a recipe in ExportRecipes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
}

/// Split a PascalCase path segment into space-separated words.
/// e.g. "GarudaSystemsBlueprint" → "Garuda Systems Blueprint"
///      "ChromaBeaconCComponent"  → "Chroma Beacon C Component"
pub(crate) fn camel_to_words(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        let prev_lower = i > 0 && chars[i - 1].is_lowercase();
        let prev_up_next_lo = i > 0
            && chars[i - 1].is_uppercase()
            && i + 1 < chars.len()
            && chars[i + 1].is_lowercase();
        if c.is_uppercase() && i > 0 && (prev_lower || prev_up_next_lo) {
            out.push(' ');
        }
        out.push(c);
    }
    out
}

/// Determine the correct display category for an item, using all three WFCD fields
/// in priority order: type → productCategory → category (display) → name/path heuristics.
pub(crate) fn fix_category(
    name: &str,
    item_type: &str,
    product_category: &str,
    wfcd_cat: &str,
    path: &str,
) -> String {
    // ── Tier 0: explicit exclusions ────────────────────────────────────────────
    // Exalted Weapons are frame abilities, not player inventory items.
    if matches!(item_type, "Exalted Weapon" | "Node") {
        return "Excluded".to_string();
    }
    // Nightwave/Season challenge definitions leak from the account blob.
    // They have item_type="Rifle"/"Pistol" etc. which would wrongly place them
    // in weapon categories. Exclude them entirely — they are not inventory items.
    if path.contains("/Types/Challenges/") {
        return "Excluded".to_string();
    }

    // ── Tier 1: Mods and Arcanes ───────────────────────────────────────────────
    // Checked BEFORE the Blueprint name rule — some mods/arcanes have "Blueprint"
    // in their display name (e.g. "Balefire Surge Blueprint") and must not flip.
    if wfcd_cat == "Mods" {
        return "Mods".to_string();
    }
    if wfcd_cat == "Arcanes" {
        return "Arcanes".to_string();
    }

    // ── Tier 2: Blueprint name rule ────────────────────────────────────────────
    if name.contains("Blueprint") {
        return "Blueprints".to_string();
    }

    // ── Tier 3: type field — most reliable, covers all 17 000 items ───────────
    match item_type {
        "Warframe" => return "Warframes".to_string(),

        // Companion weapons MUST come before Primary/Secondary checks — WFCD stores
        // Sentinel weapons (Akaten, Sweeper, Verglas, etc.) with category=Primary.
        "Companion Weapon" => return "Companions".to_string(),

        "Rifle" | "Shotgun" | "Bow" | "Sniper" | "Launcher" | "Throwing" => {
            // Railjack turrets/crew weapons share weapon types with Primary weapons.
            if product_category == "CrewShipWeapons" {
                return "Railjack".to_string();
            }
            return "Primary".to_string();
        }

        "Pistol" | "Dual Pistols" => {
            // Amp Prisms (barrels) have type=Pistol but live under /OperatorAmplifiers/.
            if path.contains("/OperatorAmplifiers/") {
                return "Operator Weapons".to_string();
            }
            // Sirocco has type=Pistol but productCategory=OperatorAmps.
            if product_category == "OperatorAmps" {
                return "Operator Weapons".to_string();
            }
            if product_category != "SentinelWeapons" {
                return "Secondary".to_string();
            }
        }

        "Melee" => return "Melee".to_string(),
        "Sentinel" => return "Companions".to_string(),
        "Pets" => return "Companions".to_string(),
        "Archwing" => return "Archwing".to_string(),
        "Arch-Gun" => return "Archwing".to_string(),
        "Arch-Melee" => return "Archwing".to_string(),
        "Railjack Turret" => return "Railjack".to_string(),
        "Relic" => return "Relics".to_string(),

        // Modular weapon and companion components → Parts
        "Zaw Component" | "Kitgun Component" | "K-Drive Component" | "Amp" | "Pet Resource"
        | "Pet Parts" => return "Parts".to_string(),

        // Forma, Catalysts, Reactors, Arcane Adapters — consumable equipment items.
        // WFCD groups these under their slot category (Primary/Secondary/etc.) but
        // they are not weapons — treat them as Resources.
        "Equipment Adapter" => return "Resources".to_string(),

        // Stackable resources
        "Resource" | "Fish" | "Fish Part" | "Gem" | "Cut Gem" | "Plant" | "Alloy" | "Medallion"
        | "Ayatan Sculpture" | "Ayatan Star" | "Eidolon Shard" | "Gear" | "Key"
        | "Conservation Tag" | "Conservation Prey" | "Boosters" | "Focus Way" | "Focus Lens"
        | "Currency" | "Fish Bait" | "Specter" | "Extractor" => return "Resources".to_string(),

        // Cosmetics — Sigils and Glyphs get their own tabs
        "Sigil" => return "Sigils".to_string(),
        "Glyph" => return "Glyphs".to_string(),

        "Skin" | "Emotes" | "Color Palette" | "Fur Color" | "Fur Pattern" | "Themes"
        | "Theme Background" | "Theme Sound" | "Ship Decoration" | "Syandana" | "Pet Collar"
        | "Captura" | "Simulacrum" | "Orbiter" | "Skins" => {
            if path.contains("/RailJack/") {
                return "Railjack".to_string();
            }
            return "Skins".to_string();
        }

        _ => {} // fall through to productCategory
    }

    // ── Tier 4: productCategory — very clean for the 1 137 items that have it ─
    match product_category {
        "Suits" | "MechSuits" => return "Warframes".to_string(),
        "LongGuns" => return "Primary".to_string(),
        "Melee" => return "Melee".to_string(),
        "SentinelWeapons" => return "Companions".to_string(),
        "OperatorAmps" => return "Operator Weapons".to_string(),
        "SpaceSuits" => return "Archwing".to_string(),
        "SpaceGuns" => return "Archwing".to_string(),
        "SpaceMelee" => return "Archwing".to_string(),
        "Sentinels" | "KubrowPets" => return "Companions".to_string(),
        "CrewShipWeapons" => return "Railjack".to_string(),
        _ => {}
    }

    // ── Tier 5: wfcd_cat display-category fallback ─────────────────────────────
    match wfcd_cat {
        "Companions" => return "Companions".to_string(),
        "Archwing" => return "Archwing".to_string(),
        "Railjack" => return "Railjack".to_string(),
        "Resources" => return "Resources".to_string(),
        // wfcd.rs explicitly sets category="Parts" for built recipe components
        // (warframe parts, weapon components). Trust that assignment here so they
        // never fall to the Miscellaneous catch-all.
        "Parts" => return "Parts".to_string(),
        "Primary" => return "Primary".to_string(),
        "Secondary" => return "Secondary".to_string(),
        "Warframes" => return "Warframes".to_string(),
        "Relics" => {
            // Guard against non-relic items WFCD mis-groups under Relics (segments, etc.)
            let n = name.to_lowercase();
            if n.ends_with("intact")
                || n.ends_with("exceptional")
                || n.ends_with("flawless")
                || n.ends_with("radiant")
            {
                return "Relics".to_string();
            }
        }
        "Sigils" => return "Sigils".to_string(),
        "Glyphs" => return "Glyphs".to_string(),
        _ => {}
    }

    // ── Tier 6: path guards for sub-components type/productCategory doesn't cover
    if path.contains("/MoaPetEngine")
        || path.contains("/MoaPetPayload")
        || path.contains("/MoaPetLeg")
        || path.contains("/ZanukaPetPartBody")
        || path.contains("/ZanukaPetPartLegs")
        || path.contains("/ZanukaPetPartTail")
        || path.contains("/CreaturePetParts/")
    {
        return "Parts".to_string();
    }

    // ── Tier 7: name-suffix fallback for direct-drop components ───────────────
    // Warframe-frame components (Chassis, Neuroptics, Systems) always carry
    // "Blueprint" in their name, caught above. These suffixes cover weapon parts
    // and companion components that drop pre-built.
    const PART_SUFFIXES: &[&str] = &[
        " receiver",
        " stock",
        " barrel",
        " blade",
        " handle",
        " guard",
        " hilt",
        " link",
        " gauntlet",
        " carapace",
        " cerebrum",
        " systems",
        " upper limb",
        " lower limb",
        " strike",
        " boot",
        " head",
        " grip",
        // Bow/thrown weapon components
        " string",
        " disc",
        " stars",
        // Modular companion (MOA) components — gyrome/loader/bracket are never the companion itself
        " gyrome",
        " loader",
        " bracket",
    ];
    let lower = name.to_lowercase();
    if PART_SUFFIXES.iter().any(|s| lower.ends_with(s)) {
        return "Parts".to_string();
    }

    // WFCD mis-tags some direct-drop components as "Blueprints" (no "Blueprint" in name).
    if wfcd_cat == "Blueprints" {
        return "Parts".to_string();
    }

    // ── Tier 8: path-prefix rules ──────────────────────────────────────────────
    // Bandaid categorization for paths WFCD doesn't cover. Items caught here still
    // land in the Unmatched Paths debug file (reason: "path_rule") so they can get
    // explicit name corrections in corrections.json in the future.
    if path.contains("/CosmeticEnhancers/Antiques/") {
        return "Arcanes".to_string();
    }
    if path.contains("/SentinelPrecepts/") {
        return "Mods".to_string();
    }
    if path.contains("/MeleeTrees/") {
        return "Mods".to_string();
    }

    // ── Catch-all ──────────────────────────────────────────────────────────────
    "Miscellaneous".to_string()
}

/// Return the "X Prime" prefix (e.g. "Lex Prime") for a prime item name, or None.
fn prime_set_prefix(name: &str) -> Option<String> {
    let lower = name.to_lowercase();
    let pos = lower.find("prime")?;
    Some(name[..pos + 5].to_string()) // 5 = "prime".len()
}

/// WFCD marks all Amp components as `masterable: false`, but Prisms (barrels)
/// DO grant mastery XP. Path-based overrides run first so they beat WFCD's value.
fn resolve_masterable(wfcd: Option<bool>, path: &str) -> Option<bool> {
    if !path.ends_with("Blueprint") {
        // Amp Prisms (barrels) grant mastery; WFCD incorrectly says false.
        if path.contains("/OperatorAmplifiers/") && path.contains("/Barrel/") {
            return Some(true);
        }
        // Operator amp weapons (Sirocco, etc.) grant mastery.
        if path.contains("/Operator/Pistols/") {
            return Some(true);
        }
    }
    wfcd
}

fn get_all_items_inner(state: &AppState) -> Vec<CatalogItem> {
    // Clone data and release locks immediately — the catalog build below is O(n²)
    // and holding the locks blocks the monitor thread and other commands.
    let items: Vec<wfcd::WfcdItem> = state
        .wfcd_items
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let bp_names: HashMap<String, (String, Option<u32>)> = state
        .blueprint_to_result
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let corrections = &state.corrections;
    let items = &items;
    let bp_names = &bp_names;

    // ExportRecipes is the authoritative source for blueprint items — their paths
    // match what the Warframe API returns in data.Recipes.
    // WFCD is authoritative for everything else (main warframes, weapons, parts).
    //
    // Strategy:
    //  1. Add all non-blueprint WFCD items (category ≠ "Blueprints" and
    //     unique_name doesn't start with /Lotus/Types/Recipes/)
    //  2. Add ALL ExportRecipes blueprint entries (no dedup needed — the map
    //     is keyed by unique_name so each entry appears only once)
    //  3. Add WFCD-only blueprints not covered by ExportRecipes (older content)
    //
    // This eliminates the "Dante Blueprint" duplicate: WFCD's recipe-path entry
    // is replaced by ExportRecipes' entry which matches the API path exactly.

    // ── Rebuild to eliminate cross-source blueprint duplicates ───────────────
    //
    // Root cause: WFCD stores the same blueprint at MULTIPLE paths (recipe path
    // + non-recipe path), causing it to appear in every category.
    //
    // Fix: ExportRecipes blueprints go in FIRST (authoritative API-matching
    // paths). WFCD blueprint items are then skipped if ExportRecipes already
    // has them by display name. WFCD non-blueprint items always go in.
    // ─────────────────────────────────────────────────────────────────────────

    let mut result: Vec<CatalogItem> = Vec::new();

    // Items whose base names can never have a real blueprint (Mods, Arcanes).
    // ExportRecipes sometimes contains phantom entries like "Ballistic Bullseye
    // Blueprint" even though mods cannot be crafted — we skip those here so
    // the inventory never shows a mod under the wrong name or category.
    let non_craftable_names: std::collections::HashSet<String> = items
        .iter()
        .filter(|i| i.category == "Mods" || i.category == "Arcanes")
        .map(|i| i.name.to_lowercase())
        .collect();

    // Phase 1: ExportRecipes blueprints (correct API paths, 1 per name)
    // Build a name→vaulted map from WFCD so blueprints inherit the correct vaulted status.
    // ExportRecipes has no vaulted field; WFCD does.  We look up by bp_name first, then
    // fall back to the base name without " Blueprint" (covers weapon/warframe entries).
    let wfcd_vaulted: std::collections::HashMap<String, Option<bool>> = items
        .iter()
        .map(|i| (i.name.to_lowercase(), i.vaulted))
        .collect();

    // Vaulted lookup helper: exact name → base without " Blueprint" → "X Prime" set entry.
    // WFCD's vaulted flag is most reliably set on the assembled warframe/weapon ("Mag Prime",
    // "Venato Prime") rather than on every individual component.  Falling back to the set entry
    // means components never lose the lock icon just because WFCD left their own field null.
    let prime_vaulted = |name: &str| -> Option<bool> {
        let n = name.to_lowercase();
        let base = n.strip_suffix(" blueprint").unwrap_or(&n).to_string();
        let prime_key = n.find("prime").map(|pos| n[..pos + 5].to_string());
        wfcd_vaulted
            .get(&n)
            .and_then(|v| *v)
            .or_else(|| wfcd_vaulted.get(&base).and_then(|v| *v))
            .or_else(|| {
                prime_key
                    .as_deref()
                    .and_then(|pk| wfcd_vaulted.get(pk).and_then(|v| *v))
            })
    };

    let mut bp_names_added: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (bp_unique, (bp_name, bp_ducats)) in bp_names.iter() {
        // Skip phantom blueprint entries for mods/arcanes.
        // Strip the " Blueprint" suffix and check against the known mod names.
        let base = bp_name
            .strip_suffix(" Blueprint")
            .unwrap_or(bp_name)
            .to_lowercase();
        if non_craftable_names.contains(&base) {
            continue;
        }

        let n = bp_name.to_lowercase();
        if bp_names_added.insert(n.clone()) {
            let vaulted = prime_vaulted(bp_name);
            result.push(CatalogItem {
                unique_name: bp_unique.clone(),
                name: bp_name.clone(),
                category: "Blueprints".to_string(),
                image_name: None,
                vaulted,
                ducats: *bp_ducats,
                mastery_req: None,
                max_level_cap: None,
                masterable: None,
                tradeable_wfm: None,
                source_type: None,
            });
        }
    }

    // Phase 2: WFCD items — keep WFCD categories, only fix blueprint names.
    // Skip blueprints already covered by ExportRecipes or already added
    // (WFCD may store the same blueprint at multiple paths).
    for i in items
        .iter()
        .filter(|i| !i.unique_name.contains("PvPVariant"))
    {
        let cat = fix_category(
            &i.name,
            &i.item_type,
            &i.product_category,
            &i.category,
            &i.unique_name,
        );
        if cat == "Excluded" {
            continue;
        }
        let n = i.name.to_lowercase();
        if cat == "Blueprints" && !bp_names_added.insert(n) {
            continue;
        } // skip if already seen
          // Inherit vaulted from the prime set entry when WFCD left the component field null.
        let vaulted = i.vaulted.or_else(|| {
            if i.name.to_lowercase().contains("prime") {
                prime_vaulted(&i.name)
            } else {
                None
            }
        });
        result.push(CatalogItem {
            unique_name: i.unique_name.clone(),
            name: i.name.clone(),
            category: cat,
            image_name: i.image_name.clone(),
            vaulted,
            ducats: i.ducats,
            mastery_req: i.mastery_req,
            max_level_cap: i.max_level_cap,
            masterable: i.masterable,
            tradeable_wfm: None,
            source_type: None,
        });
    }

    // Phase 3: WFCD-only blueprints NOT covered by ExportRecipes.
    for item in items.iter() {
        if !item.unique_name.starts_with("/Lotus/Types/Recipes/") {
            continue;
        }
        let n = item.name.to_lowercase();
        if !bp_names_added.insert(n) {
            continue;
        }
        let vaulted = item.vaulted.or_else(|| {
            if item.name.to_lowercase().contains("prime") {
                prime_vaulted(&item.name)
            } else {
                None
            }
        });
        result.push(CatalogItem {
            unique_name: item.unique_name.clone(),
            name: item.name.clone(),
            category: "Blueprints".to_string(),
            image_name: item.image_name.clone(),
            vaulted,
            ducats: item.ducats,
            mastery_req: item.mastery_req,
            max_level_cap: None,
            masterable: None,
            tradeable_wfm: None,
            source_type: None,
        });
    }

    // ── Corrections: remove Ignored items ────────────────────────────────────
    result.retain(|i| {
        corrections
            .get(&i.unique_name)
            .map(|c| c.category.as_deref() != Some("Ignored"))
            .unwrap_or(true)
    });

    // ── Corrections: override name/category/tradeable_wfm ─────────────────────
    for item in result.iter_mut() {
        if let Some(c) = corrections.get(&item.unique_name) {
            if let Some(ref name) = c.name {
                item.name = name.clone();
            }
            if let Some(ref cat) = c.category {
                if cat != "Ignored" {
                    item.category = cat.clone();
                }
            }
            if c.tradeable_wfm.is_some() {
                item.tradeable_wfm = c.tradeable_wfm;
            }
        }
    }

    // ── Phase 2.5: correction-only items (not in WFCD, have a name) ───────────
    {
        let covered: std::collections::HashSet<String> =
            result.iter().map(|i| i.unique_name.clone()).collect();
        for (path, c) in corrections.iter() {
            if covered.contains(path) {
                continue;
            }
            if c.category.as_deref() == Some("Ignored") {
                continue;
            }
            let name = match c.name.as_deref() {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };
            let category = c
                .category
                .clone()
                .unwrap_or_else(|| "Miscellaneous".to_string());
            result.push(CatalogItem {
                unique_name: path.clone(),
                name,
                category,
                image_name: None,
                vaulted: None,
                ducats: None,
                mastery_req: None,
                max_level_cap: None,
                masterable: None,
                tradeable_wfm: c.tradeable_wfm,
                source_type: None,
            });
        }
    }

    // Virtual currency entries (tracked via memory scan, not in WFCD).
    for (path, name, img) in [
        ("/_currency/Endo", "Endo", "/endo.webp"),
        ("/_currency/Credits", "Credits", "/credits.webp"),
        ("/_currency/Platinum", "Platinum", "/platinum.webp"),
        (
            "/_currency/PlatinumGift",
            "Platinum (Gift)",
            "/platinum-gift.webp",
        ),
    ] {
        result.push(CatalogItem {
            unique_name: path.to_string(),
            name: name.to_string(),
            category: "Miscellaneous".to_string(),
            image_name: Some(img.to_string()),
            vaulted: None,
            ducats: None,
            mastery_req: None,
            max_level_cap: None,
            masterable: None,
            tradeable_wfm: None,
            source_type: None,
        });
    }

    // Phase 4: Path-inferred items — blob paths not covered by any catalog source.
    // Rule: last path segment ends with "Blueprint" → category Blueprints, name from camelCase parse.
    // These items are still tracked in the Unmatched Paths debug file (reason: "path_inferred").
    {
        let covered: std::collections::HashSet<String> =
            result.iter().map(|i| i.unique_name.clone()).collect();
        let quantities = state
            .current_quantities
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        for path in quantities.keys() {
            if covered.contains(path) {
                continue;
            }
            let last = path.rsplit('/').next().unwrap_or(path.as_str());
            if last.ends_with("Blueprint") && path.contains("/Recipes/") {
                result.push(CatalogItem {
                    unique_name: path.clone(),
                    name: camel_to_words(last),
                    category: "Blueprints".to_string(),
                    image_name: None,
                    vaulted: None,
                    ducats: None,
                    mastery_req: None,
                    max_level_cap: None,
                    masterable: None,
                    tradeable_wfm: None,
                    source_type: None,
                });
            }
        }
    }

    // Final safety dedup by unique_name
    let mut seen_unique: std::collections::HashSet<String> = std::collections::HashSet::new();
    result.retain(|i| seen_unique.insert(i.unique_name.clone()));

    result
}

#[tauri::command]
pub(crate) fn get_all_items(state: State<AppState>) -> Vec<CatalogItem> {
    get_all_items_inner(&state)
}

/// Return catalog items for the given unique-name paths plus all set-sibling items
/// (every item whose name shares the same "X Prime" prefix).  Used by the relic
/// overlay so it never needs the full 19 000-item catalog at startup.
#[tauri::command]
pub(crate) fn get_items_by_paths(paths: Vec<String>, state: State<AppState>) -> Vec<CatalogItem> {
    let all = get_all_items_inner(&state);

    // Normalise: strip /Lotus/StoreItems/ so comparisons are consistent.
    let normalized: Vec<String> = paths
        .iter()
        .map(|p| p.replace("/Lotus/StoreItems/", "/Lotus/"))
        .collect();

    // Collect the prime-set prefixes of the directly-matched items (e.g. "Lex Prime").
    let prefixes: Vec<String> = all
        .iter()
        .filter(|i| {
            let norm = i.unique_name.replace("/Lotus/StoreItems/", "/Lotus/");
            normalized.contains(&norm) || paths.contains(&i.unique_name)
        })
        .filter_map(|i| prime_set_prefix(&i.name))
        .collect();

    // Keep an item if it was requested directly OR its name shares a set prefix.
    all.into_iter()
        .filter(|i| {
            let norm = i.unique_name.replace("/Lotus/StoreItems/", "/Lotus/");
            if normalized.contains(&norm) || paths.contains(&i.unique_name) {
                return true;
            }
            let iname = i.name.to_lowercase();
            prefixes
                .iter()
                .any(|p| iname.starts_with(&p.to_lowercase()))
        })
        .collect()
}

#[tauri::command]
pub(crate) fn get_current_quantities(state: State<AppState>) -> HashMap<String, i64> {
    let mut q = state
        .current_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let uq = state
        .unique_quantities
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    for (name, &qty) in uq.iter() {
        q.entry(name.clone()).or_insert(qty);
    }
    let mods = state.current_mods.lock().unwrap_or_else(|e| e.into_inner());
    for (path, mc) in mods.iter() {
        q.entry(path.clone()).or_insert(mc.total);
    }
    q
}

#[tauri::command]
pub(crate) fn get_player_name(state: State<AppState>) -> Option<String> {
    state
        .local_player_name
        .lock()
        .ok()
        .and_then(|name| name.clone())
}

#[tauri::command]
pub(crate) fn get_current_crafting(state: State<AppState>) -> Vec<CraftingJob> {
    state
        .current_crafting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
pub(crate) fn get_item_list_status(state: State<AppState>) -> serde_json::Value {
    let items = state.wfcd_items.lock().unwrap_or_else(|e| e.into_inner());
    let recipes = state.recipes.lock().unwrap_or_else(|e| e.into_inner());
    // Sample a few recipe keys for diagnostics
    let sample: Vec<&String> = recipes.keys().take(3).collect();
    serde_json::json!({
        "count": items.len(),
        "recipe_count": recipes.len(),
        "recipe_sample": sample,
    })
}

#[tauri::command]
pub(crate) async fn fetch_item_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<usize, String> {
    // An ETag can outlive a deleted or invalid local catalogue. In that state a
    // conditional request returns Not Modified and leaves the 15-item fallback
    // active until the user manually forces a refresh.
    let has_fallback_only = state.wfcd_items.lock().map_err(|e| e.to_string())?.len() <= 15;
    let has_no_recipes = state.recipes.lock().map_err(|e| e.to_string())?.is_empty();
    let has_no_relic_rewards = state
        .relic_rewards
        .lock()
        .map_err(|e| e.to_string())?
        .is_empty();
    let force =
        force.unwrap_or(false) || has_fallback_only || has_no_recipes || has_no_relic_rewards;
    let fetched = tauri::async_runtime::spawn_blocking(move || wfcd::fetch_items(None, force))
        .await
        .map_err(|e| e.to_string())??;
    let result = match fetched {
        cache::Fetched::New(result, _) => result,
        cache::Fetched::NotModified => {
            return Ok(state.wfcd_items.lock().map_err(|e| e.to_string())?.len());
        }
    };

    let count = apply_catalogue(&state, result)?;
    let _ = app.emit(events::CATALOGUE_UPDATED, count);
    Ok(count)
}

fn apply_catalogue(state: &AppState, result: wfcd::FetchResult) -> Result<usize, String> {
    let count = result.items.len();

    // Persist items cache
    if let Ok(json) = serde_json::to_string(
        &result
            .items
            .iter()
            .map(|i| {
                serde_json::json!({
                    "unique_name": i.unique_name, "name": i.name, "category": i.category,
                    "item_type": i.item_type, "product_category": i.product_category,
                    "image_name": i.image_name, "vaulted": i.vaulted, "ducats": i.ducats,
                    "mastery_req": i.mastery_req, "omega_attenuation": i.omega_attenuation,
                    "fusion_limit": i.fusion_limit, "max_level_cap": i.max_level_cap,
                    "masterable": i.masterable, "ducat_schema": DUCAT_SCHEMA_VERSION
                })
            })
            .collect::<Vec<_>>(),
    ) {
        let _ = std::fs::write(&state.items_cache_path, json);
    }

    // Persist recipes cache
    if let Ok(json) = serde_json::to_string(&result.recipes) {
        let _ = std::fs::write(&state.recipes_cache_path, json);
    }

    let patched_items: Vec<WfcdItem> = result
        .items
        .into_iter()
        .map(|mut i| {
            i.name = patch_item_name(&i.unique_name, &i.name);
            i.category = patch_item_category(&i.name, &i.category, &i.unique_name);
            i
        })
        .collect();
    if let Ok(json) = serde_json::to_string(&result.relic_drops) {
        let _ = std::fs::write(&state.relic_drops_cache_path, json);
    }
    if let Ok(json) = serde_json::to_string(&result.relic_rewards) {
        let _ = std::fs::write(&state.relic_rewards_cache_path, json);
    }
    let deduped = dedup_known_aliases(patched_items);

    // Write mod_max_rank into inventory_state_cache.json for every mod/arcane so it is
    // available at startup without requiring wfcd_items to be loaded first.
    let _ = persist_inventory_state_cache(&state.inventory_state_cache_path, |inv| {
        for item in deduped.iter().filter(|i| {
            i.fusion_limit.is_some() || i.max_level_cap.is_some() || {
                let cat = fix_category(
                    &i.name,
                    &i.item_type,
                    &i.product_category,
                    &i.category,
                    &i.unique_name,
                );
                matches!(
                    cat.as_str(),
                    "Warframes"
                        | "Primary"
                        | "Secondary"
                        | "Melee"
                        | "Companions"
                        | "Archwing"
                        | "Operator Weapons"
                )
            }
        }) {
            let entry = inv
                .items
                .entry(item.unique_name.clone())
                .or_insert_with(|| CachedItem {
                    unique_name: item.unique_name.clone(),
                    ..Default::default()
                });
            if entry.name.is_empty() {
                entry.name = item.name.clone();
            }
            if item.fusion_limit.is_some() {
                entry.mod_max_rank = item.fusion_limit;
            }
            // Effective level cap: use WFCD's explicit value when present (e.g. 40 for
            // Necramechs/Paracesis), otherwise fall back to the standard rank-30 cap for
            // all levelable categories. Non-levelable items get no entry.
            let effective_cap = item.max_level_cap.or_else(|| {
                let cat = fix_category(
                    &item.name,
                    &item.item_type,
                    &item.product_category,
                    &item.category,
                    &item.unique_name,
                );
                match cat.as_str() {
                    "Warframes" | "Primary" | "Secondary" | "Melee" | "Companions" | "Archwing"
                    | "Operator Weapons" => Some(30),
                    _ => None,
                }
            });
            if effective_cap.is_some() {
                entry.max_level_cap = effective_cap;
            }
        }
    });

    *state.wfcd_items.lock().map_err(|e| e.to_string())? = deduped;
    *state.recipes.lock().map_err(|e| e.to_string())? = result.recipes;
    *state.relic_drops.lock().map_err(|e| e.to_string())? = result.relic_drops;
    *state.relic_rewards.lock().map_err(|e| e.to_string())? = result.relic_rewards;
    *state
        .blueprint_to_result
        .lock()
        .map_err(|e| e.to_string())? = result.blueprint_names;
    if !result.weapon_dispositions.is_empty() {
        *state
            .weapon_dispositions
            .lock()
            .map_err(|e| e.to_string())? = result.weapon_dispositions;
    }
    if !result.wiki_reward_names.is_empty() {
        *state.wiki_reward_names.lock().map_err(|e| e.to_string())? = result.wiki_reward_names;
    }
    if !result.syndicate_catalog.is_empty() {
        if let Ok(json) = serde_json::to_string(&result.syndicate_catalog) {
            let _ = std::fs::write(&state.syndicate_catalog_path, json);
        }
        *state.syndicate_catalog.lock().map_err(|e| e.to_string())? = result.syndicate_catalog;
    }
    Ok(count)
}

// ─── Foundry / Recipes ────────────────────────────────────────────────────────

/// Returns all Primary / Secondary / Melee / Operator Weapons from the catalog (for the
/// Weapons completionist tracker). Includes non-craftable weapons (Coda, Prisms, etc.).
#[tauri::command]
pub(crate) fn get_weapon_catalog(state: State<AppState>) -> Vec<CatalogItem> {
    let items = state.wfcd_items.lock().unwrap_or_else(|e| e.into_inner());
    let corrections = &state.corrections;

    let mut result: Vec<CatalogItem> = items
        .iter()
        .filter(|i| {
            !i.unique_name.contains("PvPVariant")
                && i.item_type != "Companion Weapon"
                && i.product_category != "SentinelWeapons"
        })
        .filter_map(|i| {
            let mut cat = fix_category(
                &i.name,
                &i.item_type,
                &i.product_category,
                &i.category,
                &i.unique_name,
            );
            let mut name = i.name.clone();
            if let Some(c) = corrections.get(&i.unique_name) {
                if c.category.as_deref() == Some("Ignored") {
                    return None;
                }
                if let Some(ref cn) = c.name {
                    name = cn.clone();
                }
                if let Some(ref cc) = c.category {
                    cat = cc.clone();
                }
            }
            if !matches!(
                cat.as_str(),
                "Primary" | "Secondary" | "Melee" | "Operator Weapons"
            ) {
                return None;
            }
            Some(CatalogItem {
                unique_name: i.unique_name.clone(),
                name,
                category: cat,
                image_name: i.image_name.clone(),
                vaulted: i.vaulted,
                ducats: i.ducats,
                mastery_req: i.mastery_req,
                max_level_cap: i.max_level_cap,
                masterable: resolve_masterable(i.masterable, &i.unique_name),
                tradeable_wfm: None,
                source_type: None,
            })
        })
        .collect();

    // Corrections-only items (e.g. Prisms, Zaw Strikes) not in WFCD but tagged as a weapon category
    let covered: std::collections::HashSet<String> =
        result.iter().map(|i| i.unique_name.clone()).collect();
    for (path, c) in corrections.iter() {
        if covered.contains(path) {
            continue;
        }
        let cat = match c.category.as_deref() {
            Some(cat) if matches!(cat, "Primary" | "Secondary" | "Melee" | "Operator Weapons") => {
                cat.to_string()
            }
            _ => continue,
        };
        let name = match c.name.as_deref() {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => continue,
        };
        result.push(CatalogItem {
            unique_name: path.clone(),
            name,
            category: cat,
            image_name: None,
            vaulted: None,
            ducats: None,
            mastery_req: None,
            max_level_cap: None,
            masterable: None,
            tradeable_wfm: c.tradeable_wfm,
            source_type: None,
        });
    }
    result
}

fn acquired_source_label(name: &str, path: &str) -> &'static str {
    if name.ends_with(" Prisma") || name.starts_with("Prisma ") {
        return "baro";
    }
    if name.ends_with(" Wraith") || name.ends_with(" Vandal") || name.starts_with("MK1-") {
        return "event";
    }
    if name.starts_with("Coda ") {
        return "duviri";
    }
    if path.contains("/ZawWeapon") || path.contains("Zaw/") {
        return "zaw";
    }
    if path.contains("/Amp/") {
        return "amp";
    }
    "acquired"
}

/// Returns all items that have a crafting recipe (for the Foundry search list).
#[tauri::command]
pub(crate) fn get_craftable_items(state: State<AppState>) -> Vec<CatalogItem> {
    // Collect recipe keys first, drop the lock, then lock items separately
    // to avoid holding two locks simultaneously (prevents potential deadlock
    // with fetch_item_list which locks in the opposite order).
    let recipe_keys: std::collections::HashSet<String> = {
        let recipes = state.recipes.lock().unwrap_or_else(|e| e.into_inner());
        recipes.keys().cloned().collect()
    };
    let items = state.wfcd_items.lock().unwrap_or_else(|e| e.into_inner());
    let corrections = &state.corrections;

    let mut result: Vec<CatalogItem> = items
        .iter()
        .filter(|i| recipe_keys.contains(&i.unique_name) && !i.unique_name.contains("PvPVariant"))
        .filter_map(|i| {
            let mut cat = fix_category(
                &i.name,
                &i.item_type,
                &i.product_category,
                &i.category,
                &i.unique_name,
            );
            let mut name = i.name.clone();
            if let Some(c) = corrections.get(&i.unique_name) {
                if c.category.as_deref() == Some("Ignored") {
                    return None;
                }
                if let Some(ref cn) = c.name {
                    name = cn.clone();
                }
                if let Some(ref cc) = c.category {
                    cat = cc.clone();
                }
            }
            if cat == "Excluded" {
                return None;
            }
            Some(CatalogItem {
                unique_name: i.unique_name.clone(),
                name,
                category: cat,
                image_name: i.image_name.clone(),
                vaulted: i.vaulted,
                ducats: i.ducats,
                mastery_req: i.mastery_req,
                max_level_cap: i.max_level_cap,
                masterable: resolve_masterable(i.masterable, &i.unique_name),
                tradeable_wfm: None,
                source_type: None,
            })
        })
        .collect();

    // Corrections-only items (not in WFCD) that have a craftable recipe
    let covered: std::collections::HashSet<String> =
        result.iter().map(|i| i.unique_name.clone()).collect();
    for (path, c) in corrections.iter() {
        if covered.contains(path) {
            continue;
        }
        if !recipe_keys.contains(path) {
            continue;
        }
        if c.category.as_deref() == Some("Ignored") {
            continue;
        }
        let name = match c.name.as_deref() {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => continue,
        };
        let category = c
            .category
            .clone()
            .unwrap_or_else(|| "Miscellaneous".to_string());
        result.push(CatalogItem {
            unique_name: path.clone(),
            name,
            category,
            image_name: None,
            vaulted: None,
            ducats: None,
            mastery_req: None,
            max_level_cap: None,
            masterable: None,
            tradeable_wfm: c.tradeable_wfm,
            source_type: None,
        });
    }

    // Non-recipe weapon items — acquired in-game (Wraith, Vandal, Prisma, Coda, Zaw, Amp, etc.)
    let weapon_cats: [&str; 5] = [
        "Primary",
        "Secondary",
        "Melee",
        "Archwing",
        "Operator Weapons",
    ];
    let covered: std::collections::HashSet<String> =
        result.iter().map(|i| i.unique_name.clone()).collect();
    for i in items.iter() {
        if i.unique_name.contains("PvPVariant") {
            continue;
        }
        let mut cat = fix_category(
            &i.name,
            &i.item_type,
            &i.product_category,
            &i.category,
            &i.unique_name,
        );
        if !weapon_cats.contains(&cat.as_str()) {
            continue;
        }
        if covered.contains(&i.unique_name) {
            continue;
        }
        let mut name = i.name.clone();
        if let Some(c) = corrections.get(&i.unique_name) {
            if c.category.as_deref() == Some("Ignored") {
                continue;
            }
            if let Some(ref cn) = c.name {
                name = cn.clone();
            }
            if let Some(ref cc) = c.category {
                cat = cc.clone();
            }
        }
        if cat == "Excluded" {
            continue;
        }
        let source = acquired_source_label(&name, &i.unique_name);
        result.push(CatalogItem {
            unique_name: i.unique_name.clone(),
            name,
            category: cat,
            image_name: i.image_name.clone(),
            vaulted: i.vaulted,
            ducats: i.ducats,
            mastery_req: i.mastery_req,
            max_level_cap: i.max_level_cap,
            masterable: resolve_masterable(i.masterable, &i.unique_name),
            tradeable_wfm: None,
            source_type: Some(source.to_string()),
        });
    }

    result
}

#[tauri::command]
pub(crate) fn get_recipes_bulk(
    state: State<AppState>,
    unique_names: Vec<String>,
) -> HashMap<String, Vec<RecipeComponent>> {
    let recipes = state.recipes.lock().unwrap_or_else(|e| e.into_inner());
    unique_names
        .into_iter()
        .map(|name| {
            let r = recipes.get(&name).cloned().unwrap_or_default();
            (name, r)
        })
        .collect()
}

/// Returns the relic drop map: component unique_name → relic unique_names.
#[tauri::command]
pub(crate) fn get_relic_drops(state: State<AppState>) -> HashMap<String, Vec<String>> {
    state
        .relic_drops
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// WFCD has a recurring bug where dual-pistol component weapons get the parent's
/// name prepended. These overrides replace the bad names with the correct ones.
fn patch_item_name(unique_name: &str, name: &str) -> String {
    match unique_name {
        "/Lotus/Weapons/Tenno/Pistols/Magnum/Magnum" => "Magnus".into(),
        "/Lotus/Weapons/Tenno/Pistols/PrimeMagnus/PrimeMagnusWeapon" => "Magnus Prime".into(),
        "/Lotus/Weapons/Tenno/Pistol/BroncoPrime" => "Bronco Prime".into(),
        "/Lotus/Weapons/Tenno/Pistols/PrimeLex/PrimeLex" => "Lex Prime".into(),
        "/Lotus/Weapons/Tenno/Pistols/PrimeVasto/PrimeVastoPistol" => "Vasto Prime".into(),
        "/Lotus/Weapons/Tenno/Melee/Swords/KatanaAndWakizashi/Katana" => "Dragon Nikana".into(),
        "/Lotus/Types/Recipes/Weapons/WeaponParts/WarBlade" => "Broken War Blade".into(),
        "/Lotus/Types/Recipes/Weapons/WeaponParts/WarHilt" => "Broken War Hilt".into(),
        "/Lotus/Types/Recipes/Weapons/WeaponParts/ArchHeavyPistolsBarrel" => {
            "Dual Decurion Barrel".into()
        }
        "/Lotus/Types/Recipes/Weapons/WeaponParts/ArchHeavyPistolsReceiver" => {
            "Dual Decurion Receiver".into()
        }
        _ => name.to_string(),
    }
}

fn patch_item_category(name: &str, category: &str, unique_name: &str) -> String {
    if unique_name.contains("/Recipes/") {
        return if name.contains("Blueprint") {
            "Blueprints".to_string()
        } else {
            "Parts".to_string()
        };
    }
    if name.contains("Blueprint") {
        "Blueprints".to_string()
    } else {
        category.to_string()
    }
}

/// Bump this whenever a parsing-logic change (not an upstream data change) makes
/// previously-cached `ducats` values wrong, so upgrading users get a forced
/// one-time recompute instead of carrying stale values forever (the normal
/// refresh only refetches on an upstream ETag change, which a local logic fix
/// never triggers). v2: rarity is derived from relic reward chance-grouping
/// instead of WFCD's `rarity` string, which never labels the Common tier.
const DUCAT_SCHEMA_VERSION: u32 = 2;

pub(crate) fn load_items_cache(path: &PathBuf) -> Option<Vec<WfcdItem>> {
    let s = std::fs::read_to_string(path).ok()?;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&s).ok()?;
    // If the cache predates the item_type/product_category fields, discard it so
    // a fresh fetch populates the new fields needed by fix_category.
    if arr.first().is_some_and(|v| v.get("item_type").is_none()) {
        let _ = std::fs::remove_file(path);
        return None;
    }
    // If the cache predates masterable persistence, discard it so a fresh
    // fetch populates the flag the Foundry mastery filters depend on.
    if arr.first().is_some_and(|v| v.get("masterable").is_none()) {
        let _ = std::fs::remove_file(path);
        return None;
    }
    // If the cache predates the current ducat-derivation logic, discard it too.
    let cache_ducat_schema = arr
        .first()
        .and_then(|v| v.get("ducat_schema"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if cache_ducat_schema < DUCAT_SCHEMA_VERSION as u64 {
        let _ = std::fs::remove_file(path);
        return None;
    }
    let items: Vec<WfcdItem> = arr
        .into_iter()
        .filter_map(|v| {
            let unique_name = v["unique_name"].as_str()?.to_string();
            let raw_name = v["name"].as_str()?.to_string();
            let name = patch_item_name(&unique_name, &raw_name);
            let image_name = v["image_name"].as_str().map(|s| s.to_string());
            let vaulted = v["vaulted"].as_bool();
            let ducats = v["ducats"].as_u64().map(|n| n as u32);
            let raw_cat = v["category"].as_str()?.to_string();
            let category = patch_item_category(&name, &raw_cat, &unique_name);
            let item_type = v["item_type"].as_str().unwrap_or("").to_string();
            let product_category = v["product_category"].as_str().unwrap_or("").to_string();
            let mastery_req = v["mastery_req"].as_u64().map(|n| n as u32);
            let omega_attenuation = v["omega_attenuation"].as_f64().map(|n| n as f32);
            let fusion_limit = v["fusion_limit"].as_u64().map(|n| n as u32);
            let max_level_cap = v["max_level_cap"].as_u64().map(|n| n as u32).or_else(|| {
                if unique_name.contains("/EntratiMech/") {
                    Some(40)
                } else {
                    None
                }
            });
            let masterable = v.get("masterable").and_then(|b| b.as_bool());
            Some(WfcdItem {
                unique_name,
                name,
                category,
                item_type,
                product_category,
                image_name,
                vaulted,
                ducats,
                mastery_req,
                omega_attenuation,
                fusion_limit,
                max_level_cap,
                tradable: None,
                masterable,
            })
        })
        .collect();
    if items.is_empty() {
        None
    } else {
        Some(dedup_known_aliases(items))
    }
}

/// Remove known duplicate entries caused by the game listing the same warframe under
/// two name orderings (e.g. "Orion & Sirius" vs "Sirius & Orion").
/// Extend this list whenever DE adds another dual-character warframe with swapped names.
fn dedup_known_aliases(mut items: Vec<WfcdItem>) -> Vec<WfcdItem> {
    // Each tuple: (alias to drop, canonical name to keep)
    const ALIASES: &[(&str, &str)] = &[
        ("Orion & Sirius", "Sirius & Orion"),
        ("Orion & Sirius Blueprint", "Sirius & Orion Blueprint"),
    ];
    for (alias, canonical) in ALIASES {
        let has_canonical = items.iter().any(|i| i.name == *canonical);
        if has_canonical {
            items.retain(|i| &i.name.as_str() != alias);
        }
    }
    items
}

/// Daily pass for long-running sessions. The launch probe belongs to the
/// frontend (`fetch_item_list` at mount), so `refresh::spawn` holds this task
/// back for one full interval instead of running it at the launch tick.
pub fn refresh_catalogue(app: &tauri::AppHandle, force: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    // A valid ETag is not enough when a local cache built from the download is
    // gone: an unchanged answer would leave it empty until the sources change.
    let cache_missing =
        !state.items_cache_path.exists() || !state.relic_rewards_cache_path.exists();
    let fetched = wfcd::fetch_items(None, force || cache_missing)?;
    let result = match fetched {
        cache::Fetched::New(r, _) => r,
        cache::Fetched::NotModified => return Ok(()),
    };
    let count = apply_catalogue(&state, result)?;
    info!(items = count, "catalogue refreshed in background");
    let _ = app.emit(events::CATALOGUE_UPDATED, count);
    Ok(())
}

// ── Unmatched paths ───────────────────────────────────────────────────────────

/// How many example paths an unmatched-paths entry lists per reason.
const UNMATCHED_EXAMPLES: usize = 10;

/// Logs which inventory paths the catalogue could not place: no catalogue entry
/// at all, or an entry that falls back to Miscellaneous. Paths are game data,
/// not personal data.
pub(crate) fn log_unmatched_paths(
    blob: &memory_scanner::BlobInventory,
    path_to_name: &HashMap<String, String>,
    path_to_category: &HashMap<String, String>,
    ignored_paths: &std::collections::HashSet<String>,
) {
    let mut no_match: Vec<&str> = Vec::new();
    let mut misc: Vec<&str> = Vec::new();
    let paths = blob
        .stackable_items
        .iter()
        .map(|e| e.item_type.as_str())
        .chain(blob.unique_items.iter().map(|e| e.item_type.as_str()))
        .chain(blob.mods.keys().map(|k| k.as_str()));
    for p in paths {
        if p.starts_with("/_currency/") || ignored_paths.contains(p) {
            continue;
        }
        if !path_to_name.contains_key(p) {
            let inferred = fix_category("", "", "", "", p);
            let blueprint = p.contains("/Recipes/") && p.ends_with("Blueprint");
            if (inferred == "Miscellaneous" || inferred == "Excluded") && !blueprint {
                no_match.push(p);
            }
        } else if path_to_category
            .get(p)
            .map_or("Miscellaneous", String::as_str)
            == "Miscellaneous"
        {
            misc.push(p);
        }
    }
    if no_match.is_empty() && misc.is_empty() {
        return;
    }
    no_match.sort_unstable();
    no_match.dedup();
    misc.sort_unstable();
    misc.dedup();
    let examples = |list: &[&str]| {
        list.iter()
            .take(UNMATCHED_EXAMPLES)
            .copied()
            .collect::<Vec<_>>()
            .join(",")
    };
    hexdesk_diag::debug!(
        catalogue,
        no_catalogue_entry = no_match.len(),
        misc_fallback = misc.len(),
        no_catalogue_entry_examples = %examples(&no_match),
        misc_fallback_examples = %examples(&misc),
        "Inventory items the catalogue could not place"
    );
}

#[cfg(test)]
mod unmatched_paths_tests {
    use super::log_unmatched_paths;
    use crate::memory_scanner::{BlobInventory, BlobStackableEntry};
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;
    use tracing_subscriber::layer::SubscriberExt;

    fn item(path: &str) -> BlobStackableEntry {
        BlobStackableEntry {
            item_type: path.to_string(),
            item_count: 1,
            sockets: None,
        }
    }

    fn logged(f: impl FnOnce()) -> Vec<hexdesk_diag::Entry> {
        let collector = Arc::new(hexdesk_diag::Collector::new(hexdesk_diag::Config::default()));
        let subscriber =
            tracing_subscriber::registry().with(hexdesk_diag::DiagLayer::new(collector.clone()));
        tracing::subscriber::with_default(subscriber, f);
        collector.recent(10)
    }

    #[test]
    fn paths_the_catalogue_cannot_place_are_logged_with_examples() {
        let blob = BlobInventory {
            stackable_items: vec![
                item("/Lotus/Types/Items/MiscItems/Known"),
                item("/Lotus/Types/Items/MiscItems/InMisc"),
                item("/Lotus/Types/Unheard/Thing"),
                item("/_currency/Credits"),
            ],
            ..Default::default()
        };
        let names: HashMap<String, String> = [
            ("/Lotus/Types/Items/MiscItems/Known", "Known"),
            ("/Lotus/Types/Items/MiscItems/InMisc", "In Misc"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let categories: HashMap<String, String> = [
            ("/Lotus/Types/Items/MiscItems/Known", "Resources"),
            ("/Lotus/Types/Items/MiscItems/InMisc", "Miscellaneous"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

        let entries = logged(|| log_unmatched_paths(&blob, &names, &categories, &HashSet::new()));
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.source, "catalogue");
        let field = |k: &str| {
            e.fields
                .iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(field("no_catalogue_entry"), Some("1"));
        assert_eq!(field("misc_fallback"), Some("1"));
        assert_eq!(
            field("no_catalogue_entry_examples"),
            Some("/Lotus/Types/Unheard/Thing")
        );
        assert_eq!(
            field("misc_fallback_examples"),
            Some("/Lotus/Types/Items/MiscItems/InMisc")
        );
    }

    #[test]
    fn nothing_is_logged_when_everything_is_placed() {
        let blob = BlobInventory {
            stackable_items: vec![item("/_currency/Credits")],
            ..Default::default()
        };
        let entries = logged(|| {
            log_unmatched_paths(&blob, &HashMap::new(), &HashMap::new(), &HashSet::new())
        });
        assert!(entries.is_empty());
    }
}
