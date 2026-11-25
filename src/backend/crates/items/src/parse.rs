//! Reading WFCD's `Mods.json` and `Arcanes.json` into [`ItemDetails`].
//!
//! Field names follow warframe-items
//! (<https://github.com/WFCD/warframe-items/blob/master/index.d.ts>).
//! Each entry is read on its own, so one malformed entry costs that item and
//! not the whole file.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::details::{
    drain_at, stats_by_rank, ArcaneDetails, CardMeta, Drop, ItemDetails, ModDetails,
};
use crate::text;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawItem {
    unique_name: String,
    name: String,
    #[serde(rename = "type", default)]
    type_name: String,
    rarity: Option<String>,
    polarity: Option<String>,
    compat_name: Option<String>,
    base_drain: Option<i32>,
    fusion_limit: Option<u32>,
    #[serde(default)]
    level_stats: Vec<RawLevel>,
    description: Option<String>,
    #[serde(default)]
    is_augment: bool,
    #[serde(default)]
    is_exilus: bool,
    #[serde(default)]
    is_utility: bool,
    #[serde(default)]
    tradable: bool,
    #[serde(default)]
    drops: Vec<RawDrop>,
    wikia_url: Option<String>,
}

#[derive(Deserialize)]
struct RawLevel {
    #[serde(default)]
    stats: Vec<String>,
}

#[derive(Deserialize)]
struct RawDrop {
    #[serde(default)]
    location: String,
    #[serde(rename = "type")]
    variant: Option<String>,
    chance: Option<f64>,
    rarity: Option<String>,
}

#[derive(Clone, Copy)]
enum Kind {
    Mod,
    Arcane,
}

impl RawItem {
    fn levels(&self) -> Vec<Vec<String>> {
        self.level_stats
            .iter()
            .map(|l| text::rank_lines(&l.stats))
            .collect()
    }

    /// WFCD gives `fusionLimit` for mods only; an arcane's ranks are its
    /// per-rank entries.
    fn max_rank(&self) -> u32 {
        self.fusion_limit
            .unwrap_or_else(|| self.level_stats.len().saturating_sub(1) as u32)
    }

    fn drops(&self) -> Vec<Drop> {
        let mut drops: Vec<Drop> = self
            .drops
            .iter()
            .filter(|d| !d.location.is_empty())
            .map(|d| Drop {
                location: d.location.clone(),
                variant: d.variant.clone().filter(|v| *v != self.name),
                chance: d.chance.unwrap_or(0.0),
                rarity: d.rarity.clone(),
            })
            .collect();
        drops.sort_by(|a, b| b.chance.total_cmp(&a.chance));
        drops
    }

    /// Damage types named anywhere in the per-rank text or the description.
    fn damage_types(&self) -> Vec<String> {
        let stats = self
            .level_stats
            .iter()
            .flat_map(|l| l.stats.iter().map(String::as_str));
        text::damage_types(stats.chain(self.description.as_deref()))
    }

    fn into_details(self, kind: Kind) -> ItemDetails {
        let max_rank = self.max_rank();
        let damage_types = self.damage_types();
        let levels = self.levels();
        let description = self
            .description
            .as_deref()
            .map(text::lines)
            .unwrap_or_default();
        let stats = stats_by_rank(&levels, &description, max_rank);
        let drops = self.drops();
        match kind {
            Kind::Mod => ItemDetails::Mod(ModDetails {
                drain_by_rank: self
                    .base_drain
                    .map(|base| (0..=max_rank).map(|r| drain_at(base, r)).collect())
                    .unwrap_or_default(),
                unique_name: self.unique_name,
                name: self.name,
                type_name: self.type_name,
                rarity: self.rarity,
                polarity: self.polarity,
                compat: self.compat_name.as_deref().map(text::compat_name),
                max_rank,
                stats_by_rank: stats,
                augment: self.is_augment,
                exilus: self.is_exilus,
                utility: self.is_utility,
                damage_types,
                tradable: self.tradable,
                drops,
                wiki_url: self.wikia_url,
            }),
            Kind::Arcane => ItemDetails::Arcane(ArcaneDetails {
                unique_name: self.unique_name,
                name: self.name,
                type_name: self.type_name,
                rarity: self.rarity,
                max_rank,
                stats_by_rank: stats,
                damage_types,
                tradable: self.tradable,
                drops,
                wiki_url: self.wikia_url,
            }),
        }
    }
}

/// Item details by unique name.
#[derive(Debug, Clone, Default)]
pub struct Index {
    items: HashMap<String, ItemDetails>,
}

impl Index {
    /// Builds the index from the parsed `Mods.json` and `Arcanes.json`. A
    /// missing file leaves its items out; the first entry for a unique name
    /// wins.
    pub fn from_values(mods: Option<&Value>, arcanes: Option<&Value>) -> Self {
        let mut items = HashMap::new();
        for (file, kind) in [(mods, Kind::Mod), (arcanes, Kind::Arcane)] {
            let Some(entries) = file.and_then(Value::as_array) else {
                continue;
            };
            for entry in entries {
                if let Ok(raw) = RawItem::deserialize(entry) {
                    items
                        .entry(raw.unique_name.clone())
                        .or_insert_with(|| raw.into_details(kind));
                }
            }
        }
        Index { items }
    }

    /// Builds the index from the file bodies as text. A body that does not
    /// parse counts as missing.
    pub fn from_bodies(mods: Option<&str>, arcanes: Option<&str>) -> Self {
        let parse = |body: Option<&str>| body.and_then(|b| serde_json::from_str::<Value>(b).ok());
        let (mods, arcanes) = (parse(mods), parse(arcanes));
        Self::from_values(mods.as_ref(), arcanes.as_ref())
    }

    pub fn get(&self, unique_name: &str) -> Option<&ItemDetails> {
        self.items.get(unique_name)
    }

    /// The card facts of every item, by unique name.
    pub fn card_metas(&self) -> HashMap<String, CardMeta> {
        self.items
            .iter()
            .map(|(unique, details)| (unique.clone(), details.card_meta()))
            .collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn serration() -> Value {
        json!({
            "uniqueName": "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod",
            "name": "Serration",
            "category": "Mods",
            "type": "Primary Mod",
            "rarity": "Uncommon",
            "polarity": "madurai",
            "compatName": "Rifle",
            "baseDrain": 4,
            "fusionLimit": 2,
            "levelStats": [
                {"stats": ["+15% Damage"]},
                {"stats": ["+30% Damage"]},
                {"stats": ["+45% Damage"]}
            ],
            "tradable": true,
            "drops": [
                {"location": "Electric Crawler", "type": "Serration", "chance": 0.17, "rarity": "Rare"},
                {"location": "Scaldra Dedicant", "type": "Spectral Serration", "chance": 0.1, "rarity": "Rare"},
                {"location": "Kuva Scorpion", "type": "Serration", "chance": 0.22, "rarity": "Rare"}
            ],
            "wikiaUrl": "https://wiki.warframe.com/w/Serration"
        })
    }

    fn energize() -> Value {
        json!({
            "uniqueName": "/Lotus/Upgrades/CosmeticEnhancers/Utility/GolemArcaneRadialEnergyOnEnergyPickup",
            "name": "Arcane Energize",
            "category": "Arcanes",
            "type": "Warframe Arcane",
            "rarity": "Legendary",
            "levelStats": [
                {"stats": ["Replenish 25 Energy"]},
                {"stats": ["Replenish 50 Energy\\n+1 Arcane Revive", "+1 Arcane Revive"]}
            ],
            "tradable": true
        })
    }

    #[test]
    fn mods_carry_drain_stats_and_sorted_drops() {
        let index = Index::from_values(Some(&json!([serration()])), None);
        let Some(ItemDetails::Mod(m)) =
            index.get("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod")
        else {
            panic!("Serration is a mod");
        };
        assert_eq!(m.max_rank, 2);
        assert_eq!(m.drain_by_rank, vec![4, 5, 6]);
        assert_eq!(m.stats_by_rank[2].lines, vec!["+45% Damage"]);
        let chances: Vec<f64> = m.drops.iter().map(|d| d.chance).collect();
        assert_eq!(chances, vec![0.22, 0.17, 0.1]);
        assert_eq!(m.drops[0].variant, None);
        assert_eq!(m.drops[2].variant.as_deref(), Some("Spectral Serration"));
    }

    #[test]
    fn arcanes_take_their_ranks_from_the_entries() {
        let index = Index::from_values(None, Some(&json!([energize()])));
        let Some(ItemDetails::Arcane(a)) = index
            .get("/Lotus/Upgrades/CosmeticEnhancers/Utility/GolemArcaneRadialEnergyOnEnergyPickup")
        else {
            panic!("Arcane Energize is an arcane");
        };
        assert_eq!(a.max_rank, 1);
        assert_eq!(
            a.stats_by_rank[1].lines,
            vec!["Replenish 50 Energy", "+1 Arcane Revive"]
        );
    }

    #[test]
    fn a_malformed_entry_costs_only_itself() {
        let broken = json!({"uniqueName": 7, "name": "Broken"});
        let index = Index::from_values(Some(&json!([broken, serration()])), None);
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn the_first_entry_for_a_unique_name_wins() {
        let mut second = serration();
        second["name"] = json!("Other");
        let index = Index::from_values(Some(&json!([serration(), second])), None);
        let Some(ItemDetails::Mod(m)) =
            index.get("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod")
        else {
            panic!("Serration is a mod");
        };
        assert_eq!(m.name, "Serration");
    }

    #[test]
    fn bodies_that_do_not_parse_count_as_missing() {
        let index = Index::from_bodies(Some("not json"), None);
        assert!(index.is_empty());
    }

    #[test]
    fn card_facts_carry_damage_types_and_the_max_rank_effect() {
        let cryo = json!({
            "uniqueName": "/Lotus/Upgrades/Mods/Rifle/WeaponFreezeDamageMod",
            "name": "Cryo Rounds",
            "category": "Mods",
            "type": "Primary Mod",
            "fusionLimit": 1,
            "levelStats": [
                {"stats": ["+15% <DT_FREEZE_COLOR>Cold"]},
                {"stats": ["+30% <DT_FREEZE_COLOR>Cold"]}
            ],
            "isExilus": false
        });
        let index = Index::from_values(Some(&json!([cryo])), None);
        let meta = &index.card_metas()["/Lotus/Upgrades/Mods/Rifle/WeaponFreezeDamageMod"];
        assert_eq!(meta.damage_types, vec!["Cold"]);
        assert_eq!(meta.effect, vec!["+30% Cold"]);
    }

    #[test]
    fn card_facts_for_mods_and_arcanes() {
        let index = Index::from_values(Some(&json!([serration()])), Some(&json!([energize()])));
        let metas = index.card_metas();
        let serration = &metas["/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod"];
        assert_eq!(serration.polarity.as_deref(), Some("madurai"));
        assert_eq!(serration.compat.as_deref(), Some("Rifle"));
        assert_eq!(serration.max_rank, 2);
        let energize = &metas
            ["/Lotus/Upgrades/CosmeticEnhancers/Utility/GolemArcaneRadialEnergyOnEnergyPickup"];
        assert_eq!(energize.rarity.as_deref(), Some("Legendary"));
        assert_eq!(energize.polarity, None);
        assert_eq!(energize.type_name, "Warframe Arcane");
        assert_eq!(energize.max_rank, 1);
    }
}
