//! The items and recipes the rules look things up in.

use std::collections::HashMap;

use crate::catalogue_path;

/// One catalogue item.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub path: String,
    pub name: String,
    /// "Warframes", "Primary", "Parts", "Blueprints", "Relics", ...
    pub category: String,
    pub vaulted: Option<bool>,
    pub ducats: Option<u32>,
}

impl Item {
    /// A part or a blueprint: what a set is built from.
    pub fn is_component(&self) -> bool {
        self.category == "Parts" || self.category == "Blueprints"
    }
}

/// One line of a recipe: an ingredient and how many it takes.
#[derive(Debug, Clone, PartialEq)]
pub struct RecipeLine {
    pub path: String,
    pub name: String,
    pub count: u32,
}

/// Items by path and by name, and the recipe of each built item.
#[derive(Debug, Clone, Default)]
pub struct Catalogue {
    items: Vec<Item>,
    by_path: HashMap<String, usize>,
    by_name: HashMap<String, usize>,
    recipes: HashMap<String, Vec<RecipeLine>>,
}

impl Catalogue {
    /// `recipes` maps the path of a built item to its ingredients.
    pub fn new(items: Vec<Item>, recipes: HashMap<String, Vec<RecipeLine>>) -> Catalogue {
        let mut by_path = HashMap::new();
        let mut by_name = HashMap::new();
        for (i, item) in items.iter().enumerate() {
            by_path.entry(catalogue_path(&item.path)).or_insert(i);
            by_name.entry(item.name.to_lowercase()).or_insert(i);
        }
        let recipes = recipes
            .into_iter()
            .map(|(built, lines)| (catalogue_path(&built), lines))
            .collect();
        Catalogue {
            items,
            by_path,
            by_name,
            recipes,
        }
    }

    pub fn item(&self, path: &str) -> Option<&Item> {
        self.by_path
            .get(&catalogue_path(path))
            .map(|&i| &self.items[i])
    }

    pub fn named(&self, name: &str) -> Option<&Item> {
        self.by_name
            .get(&name.to_lowercase())
            .map(|&i| &self.items[i])
    }

    pub fn items(&self) -> &[Item] {
        &self.items
    }

    /// The ingredients of a built item.
    pub fn recipe(&self, built: &str) -> Option<&[RecipeLine]> {
        self.recipes.get(&catalogue_path(built)).map(Vec::as_slice)
    }

    /// Built items whose recipe uses `ingredient`.
    pub fn built_with(&self, ingredient: &str) -> impl Iterator<Item = &str> + '_ {
        let ingredient = catalogue_path(ingredient);
        self.recipes
            .iter()
            .filter(move |(_, lines)| lines.iter().any(|l| catalogue_path(&l.path) == ingredient))
            .map(|(built, _)| built.as_str())
    }
}
