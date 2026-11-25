//! What the item info window shows for one item, and the rules behind it.

use serde::{Deserialize, Serialize};

/// The few facts an item card shows next to the name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardMeta {
    /// "Common", "Uncommon", "Rare" or "Legendary".
    pub rarity: Option<String>,
    /// Lower case, as WFCD writes it: "madurai", "aura", "umbra", ...
    pub polarity: Option<String>,
    /// What a mod fits: a weapon class, a warframe, "Aura", ...
    pub compat: Option<String>,
    /// "Primary Mod", "Warframe Arcane", ...
    pub type_name: String,
    pub max_rank: u32,
    pub augment: bool,
}

/// The effect text at one rank.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RankStats {
    /// The effect, one entry per line, without markup.
    pub lines: Vec<String>,
    /// The rank this text was written for. It differs from the rank shown
    /// when WFCD lists fewer ranks than the item has; those ranks show the
    /// highest rank listed. `None` when the text is a general description.
    pub text_rank: Option<u32>,
}

/// One place an item drops.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Drop {
    /// An enemy, a mission rotation or a bounty stage.
    pub location: String,
    /// The name the drop table uses when it differs from the item's, such as
    /// "Spectral Serration".
    pub variant: Option<String>,
    /// Percent per roll, as the drop tables give it.
    pub chance: f64,
    pub rarity: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModDetails {
    pub unique_name: String,
    pub name: String,
    /// "Primary Mod", "Warframe Mod", "Stance Mod", ...
    pub type_name: String,
    pub rarity: Option<String>,
    pub polarity: Option<String>,
    pub compat: Option<String>,
    pub max_rank: u32,
    /// Capacity per rank, index = rank. Negative for mods that add capacity
    /// (auras and stances). Empty when WFCD gives no base drain.
    pub drain_by_rank: Vec<i32>,
    /// Effect per rank, index = rank. Empty when WFCD has no text.
    pub stats_by_rank: Vec<RankStats>,
    pub augment: bool,
    pub exilus: bool,
    pub utility: bool,
    pub tradable: bool,
    /// Highest chance first.
    pub drops: Vec<Drop>,
    pub wiki_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArcaneDetails {
    pub unique_name: String,
    pub name: String,
    /// "Warframe Arcane", "Primary Arcane", "Operator Arcane", ...
    pub type_name: String,
    pub rarity: Option<String>,
    pub max_rank: u32,
    /// Effect per rank, index = rank.
    pub stats_by_rank: Vec<RankStats>,
    pub tradable: bool,
    /// Highest chance first.
    pub drops: Vec<Drop>,
    pub wiki_url: Option<String>,
}

/// The details of one item, tagged by `kind` for the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ItemDetails {
    Mod(ModDetails),
    Arcane(ArcaneDetails),
}

impl ItemDetails {
    pub fn unique_name(&self) -> &str {
        match self {
            ItemDetails::Mod(m) => &m.unique_name,
            ItemDetails::Arcane(a) => &a.unique_name,
        }
    }

    pub fn card_meta(&self) -> CardMeta {
        match self {
            ItemDetails::Mod(m) => CardMeta {
                rarity: m.rarity.clone(),
                polarity: m.polarity.clone(),
                compat: m.compat.clone(),
                type_name: m.type_name.clone(),
                max_rank: m.max_rank,
                augment: m.augment,
            },
            ItemDetails::Arcane(a) => CardMeta {
                rarity: a.rarity.clone(),
                type_name: a.type_name.clone(),
                max_rank: a.max_rank,
                ..CardMeta::default()
            },
        }
    }
}

/// Mod capacity at a rank. Each rank costs one more capacity; a mod that adds
/// capacity (negative drain) adds one more per rank instead.
pub fn drain_at(base: i32, rank: u32) -> i32 {
    let rank = i32::try_from(rank).unwrap_or(i32::MAX);
    if base < 0 {
        base.saturating_sub(rank)
    } else {
        base.saturating_add(rank)
    }
}

/// Effect text for ranks 0 to `max_rank` from WFCD's per-rank lines.
///
/// WFCD lists one entry per rank, but some items list more (extra entries are
/// past the max rank and dropped) or fewer (missing ranks show the highest
/// rank listed). Without per-rank lines the description stands for every rank.
pub fn stats_by_rank(
    levels: &[Vec<String>],
    description: &[String],
    max_rank: u32,
) -> Vec<RankStats> {
    if levels.is_empty() {
        if description.is_empty() {
            return Vec::new();
        }
        return (0..=max_rank)
            .map(|_| RankStats {
                lines: description.to_vec(),
                text_rank: None,
            })
            .collect();
    }
    let last = levels.len() - 1;
    (0..=max_rank)
        .map(|rank| {
            let index = (rank as usize).min(last);
            RankStats {
                lines: levels[index].clone(),
                text_rank: Some(index as u32),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &[&str]) -> Vec<String> {
        s.iter().map(|l| l.to_string()).collect()
    }

    #[test]
    fn drain_grows_by_one_per_rank() {
        assert_eq!(drain_at(4, 0), 4);
        assert_eq!(drain_at(4, 10), 14);
    }

    #[test]
    fn capacity_mods_add_one_more_per_rank() {
        assert_eq!(drain_at(-2, 0), -2);
        assert_eq!(drain_at(-2, 5), -7);
    }

    #[test]
    fn one_entry_per_rank_maps_straight() {
        let levels = vec![lines(&["+10% Damage"]), lines(&["+20% Damage"])];
        let out = stats_by_rank(&levels, &[], 1);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].lines, lines(&["+20% Damage"]));
        assert_eq!(out[1].text_rank, Some(1));
    }

    #[test]
    fn entries_past_the_max_rank_are_dropped() {
        let levels: Vec<Vec<String>> = (0..9).map(|i| lines(&[&format!("level {i}")])).collect();
        let out = stats_by_rank(&levels, &[], 5);
        assert_eq!(out.len(), 6);
        assert_eq!(out[5].lines, lines(&["level 5"]));
    }

    #[test]
    fn missing_ranks_show_the_highest_rank_listed() {
        let levels = vec![lines(&["rank 0"]), lines(&["rank 1"])];
        let out = stats_by_rank(&levels, &[], 3);
        assert_eq!(out[3].lines, lines(&["rank 1"]));
        assert_eq!(out[3].text_rank, Some(1));
    }

    #[test]
    fn description_stands_for_every_rank_without_levels() {
        let out = stats_by_rank(&[], &lines(&["Orbiting slashes."]), 2);
        assert_eq!(out.len(), 3);
        assert!(out.iter().all(|r| r.text_rank.is_none()));
        assert!(stats_by_rank(&[], &[], 2).is_empty());
    }
}
