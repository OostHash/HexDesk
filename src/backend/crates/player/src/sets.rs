//! Item sets: which set an item belongs to, its parts, how many of each the
//! player has, and how many whole sets that makes.

use crate::catalogue::{Catalogue, Item};
use crate::inventory::{sum, Count, Inventory};

const FRAME_PARTS: [&str; 3] = [
    " Neuroptics Blueprint",
    " Chassis Blueprint",
    " Systems Blueprint",
];
const PART_SUFFIXES: [&str; 28] = [
    " Upper Limb",
    " Lower Limb",
    " Receiver",
    " Barrel",
    " Stock",
    " Blade",
    " Handle",
    " Guard",
    " Hilt",
    " Link",
    " Gauntlet",
    " Carapace",
    " Cerebrum",
    " Systems",
    " Head",
    " Strike",
    " Boot",
    " String",
    " Disc",
    " Neuroptics",
    " Chassis",
    " Stars",
    " Grip",
    " Pouch",
    " Ornament",
    " Band",
    " Buckle",
    " Chain",
];

/// The set an item belongs to: "Rhino Prime Chassis Blueprint" → "Rhino
/// Prime". None when the name names no part or blueprint.
pub fn set_name_of(item: &str) -> Option<&str> {
    if let Some(set) = FRAME_PARTS.iter().find_map(|s| item.strip_suffix(s)) {
        return Some(set);
    }
    if let Some(set) = PART_SUFFIXES.iter().find_map(|s| item.strip_suffix(s)) {
        return Some(set);
    }
    let base = item.strip_suffix(" Blueprint")?;
    Some(
        PART_SUFFIXES
            .iter()
            .find_map(|s| base.strip_suffix(s))
            .unwrap_or(base),
    )
}

/// The built item of a set: named after the set, not a part or blueprint.
pub fn set_item<'a>(catalogue: &'a Catalogue, set: &str) -> Option<&'a Item> {
    catalogue
        .items()
        .iter()
        .find(|i| i.name == set && !i.is_component())
}

/// One part of a set, with how many the player has.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SetPart {
    pub path: String,
    pub name: String,
    pub needed: u32,
    pub owned: Count,
    pub ducats: Option<u32>,
}

/// Copies of a set part the player can use: the item itself, its other form
/// (a part's blueprint, or a blueprint's built part) and Foundry jobs.
pub fn copies(catalogue: &Catalogue, inventory: &Inventory, path: &str, name: &str) -> Count {
    let item = catalogue.item(path).or_else(|| catalogue.named(name));
    let (path, name) = item.map_or((path, name), |i| (i.path.as_str(), i.name.as_str()));
    let other = match name.strip_suffix(" Blueprint") {
        Some(part) => catalogue.named(part).filter(|i| i.category == "Parts"),
        None => catalogue
            .named(&format!("{name} Blueprint"))
            .filter(|i| i.category == "Blueprints"),
    };
    let foundry = {
        let own = inventory.in_foundry(path, name);
        match other {
            Some(o) if own.total == 0 => inventory.in_foundry(&o.path, &o.name),
            _ => own,
        }
    };
    sum([
        inventory.count(path, name),
        other.map_or_else(Count::default, |o| inventory.count(&o.path, &o.name)),
        foundry,
    ])
}

/// The parts of a set: the components of the built item's recipe, or, when
/// the catalogue has no recipe, every part and blueprint named after the set
/// (one each). A set has at least two parts: an item built from its
/// blueprint alone, such as Forma, is no set. None when there are fewer.
pub fn set_parts(catalogue: &Catalogue, inventory: &Inventory, set: &str) -> Option<Vec<SetPart>> {
    let part = |path: &str, name: &str, needed: u32| {
        let item = catalogue.item(path);
        SetPart {
            path: path.to_string(),
            name: item.map_or(name, |i| i.name.as_str()).to_string(),
            needed,
            owned: copies(catalogue, inventory, path, name),
            ducats: item.and_then(|i| i.ducats),
        }
    };
    let from_recipe: Vec<SetPart> = set_item(catalogue, set)
        .and_then(|built| catalogue.recipe(&built.path))
        .unwrap_or_default()
        .iter()
        .filter(|line| catalogue.item(&line.path).is_some_and(Item::is_component))
        .map(|line| part(&line.path, &line.name, line.count.max(1)))
        .collect();
    if from_recipe.len() >= 2 {
        return Some(from_recipe);
    }
    let prefix = format!("{set} ");
    let by_name: Vec<SetPart> = catalogue
        .items()
        .iter()
        .filter(|i| i.name.starts_with(&prefix) && i.is_component())
        .map(|i| part(&i.path, &i.name, 1))
        .collect();
    (by_name.len() >= 2).then_some(by_name)
}

/// Whole sets the player could build from their parts; owning the built
/// item counts as at least one.
pub fn complete_sets(parts: &[SetPart], built_owned: bool) -> u32 {
    let sets = parts
        .iter()
        .map(|p| p.owned.total.max(0) as u32 / p.needed.max(1))
        .min()
        .unwrap_or(0);
    if built_owned {
        sets.max(1)
    } else {
        sets
    }
}

/// Whether the player has an item, or an item built with it (a part is used
/// up when its weapon is built).
pub fn has_item_or_build(catalogue: &Catalogue, inventory: &Inventory, name: &str) -> bool {
    let Some(item) = catalogue.named(name) else {
        return false;
    };
    if inventory.count(&item.path, &item.name).total > 0 {
        return true;
    }
    catalogue.built_with(&item.path).any(|built| {
        let built_name = catalogue.item(built).map_or(built, |i| i.name.as_str());
        inventory.count(built, built_name).total > 0
    })
}

/// What the Relic Reward overlay shows for one reward.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RewardCard {
    pub path: String,
    pub name: String,
    /// The catalogue does not know the path.
    pub unknown: bool,
    pub category: Option<String>,
    pub vaulted: Option<bool>,
    pub ducats: Option<u32>,
    pub set_name: Option<String>,
    pub parts: Option<Vec<SetPart>>,
    /// The built item of the set, when the catalogue has one.
    pub built: Option<Count>,
    pub complete_sets: Option<u32>,
}

/// The card for a reward path.
pub fn reward_card(catalogue: &Catalogue, inventory: &Inventory, path: &str) -> RewardCard {
    let Some(item) = catalogue.item(path) else {
        return RewardCard {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            unknown: true,
            category: None,
            vaulted: None,
            ducats: None,
            set_name: None,
            parts: None,
            built: None,
            complete_sets: None,
        };
    };
    let set = set_name_of(&item.name);
    let parts = set.and_then(|s| set_parts(catalogue, inventory, s));
    let built = set
        .and_then(|s| set_item(catalogue, s))
        .map(|b| inventory.count(&b.path, &b.name));
    let complete_sets = parts
        .as_ref()
        .map(|p| complete_sets(p, built.as_ref().is_some_and(|b| b.total > 0)));
    RewardCard {
        path: item.path.clone(),
        name: item.name.clone(),
        unknown: false,
        category: Some(item.category.clone()),
        vaulted: item.vaulted,
        ducats: item.ducats,
        set_name: parts.as_ref().and(set).map(str::to_string),
        parts,
        built,
        complete_sets,
    }
}

impl RewardCard {
    /// One line for the log: each part with how many the player has and
    /// where each count comes from.
    pub fn explain(&self, time: &dyn Fn(crate::Millis) -> String) -> String {
        let Some(parts) = &self.parts else {
            return self.name.clone();
        };
        let set = self.set_name.as_deref().unwrap_or("");
        let built = self
            .built
            .as_ref()
            .map(|b| format!("; built {}: {}", b.total, b.explain(time)))
            .unwrap_or_default();
        let parts = parts
            .iter()
            .map(|p| {
                let short = p.name.strip_prefix(&format!("{set} ")).unwrap_or(&p.name);
                format!(
                    "{short} {}/{} = {}",
                    p.owned.total,
                    p.needed,
                    p.owned.explain(time)
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        format!(
            "{}: {} complete set(s); {parts}{built}",
            self.name,
            self.complete_sets.unwrap_or(0)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_names() {
        assert_eq!(
            set_name_of("Rhino Prime Chassis Blueprint"),
            Some("Rhino Prime")
        );
        assert_eq!(set_name_of("Paris Prime Upper Limb"), Some("Paris Prime"));
        assert_eq!(set_name_of("Bronco Prime Receiver"), Some("Bronco Prime"));
        assert_eq!(
            set_name_of("Kompressa Prime Blueprint"),
            Some("Kompressa Prime")
        );
        assert_eq!(set_name_of("Forma Blueprint"), Some("Forma"));
        assert_eq!(set_name_of("Orokin Cell"), None);
        assert_eq!(set_name_of("Paris Prime Grip"), Some("Paris Prime"));
        assert_eq!(set_name_of("Spira Prime Pouch"), Some("Spira Prime"));
    }
}
