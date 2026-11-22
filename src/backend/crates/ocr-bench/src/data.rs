//! The local data the bench reads: the labelled screens and the relic names
//! from the app's caches. None of it is in the repository, because the
//! screens show player names.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Where the bench keeps its screens, labels and results, and where it
/// finds the app's caches.
pub struct Data {
    /// The `.hexdesk-dev` folder of a development checkout.
    pub dev: PathBuf,
}

impl Data {
    pub fn bench(&self) -> PathBuf {
        self.dev.join("ocr-bench")
    }

    /// Screens of one reader, such as `relic-list`.
    pub fn screens(&self, reader: &str) -> PathBuf {
        self.bench().join(reader)
    }

    pub fn results(&self) -> PathBuf {
        self.bench().join("results")
    }

    pub fn captures(&self) -> PathBuf {
        self.dev.join("state").join("captures")
    }

    pub fn ocr_models(&self) -> PathBuf {
        self.dev.join("cache").join("ocr_models")
    }

    /// Every relic of an era as a relic list names it ("Meso V13"), from
    /// the item catalogue the app downloads.
    pub fn era_relics(&self, era: &str) -> Result<Vec<String>, String> {
        let path = self.dev.join("cache").join("catalogue").join("Relics.json");
        let items: Vec<serde_json::Value> = read_json(&path)?;
        Ok(relic_names(
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(|n| n.as_str())),
            era,
        ))
    }

    /// The relics of an era the cached inventory holds at least one of: the
    /// names the app tries first, as it does on the player's own screens.
    pub fn owned_relics(&self, era: &str) -> Result<Vec<String>, String> {
        let path = self.dev.join("cache").join("inventory_state_cache.json");
        let cache: serde_json::Value = read_json(&path)?;
        let items = cache
            .get("items")
            .and_then(|items| items.as_object())
            .ok_or_else(|| format!("{} holds no items", path.display()))?;
        Ok(relic_names(
            items
                .values()
                .filter(|item| item.get("category").and_then(|c| c.as_str()) == Some("Relics"))
                .filter(|item| item.get("amount").and_then(|a| a.as_u64()).unwrap_or(0) > 0)
                .filter_map(|item| item.get("name").and_then(|n| n.as_str())),
            era,
        ))
    }
}

/// The base names ("Meso V13") of relic names with their refinement
/// ("Meso V13 Intact") that belong to `era` ("MESO", or "ALL" for every era).
fn relic_names<'a>(names: impl Iterator<Item = &'a str>, era: &str) -> Vec<String> {
    let prefix = match era {
        "ALL" => String::new(),
        era => {
            let mut chars = era.chars();
            let first = chars.next().map(|c| c.to_ascii_uppercase());
            format!(
                "{}{} ",
                first.map(String::from).unwrap_or_default(),
                chars.as_str().to_ascii_lowercase()
            )
        }
    };
    names
        .filter(|name| name.starts_with(&prefix))
        .filter_map(|name| name.rsplit_once(' ').map(|(base, _)| base.to_string()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text + "\n").map_err(|e| format!("write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relic_names_keep_the_era_and_drop_the_refinement() {
        let names = [
            "Meso V13 Intact",
            "Meso V13 Radiant",
            "Neo V13 Intact",
            "Requiem Eterna Relic",
        ];
        assert_eq!(relic_names(names.into_iter(), "MESO"), ["Meso V13"]);
        assert_eq!(relic_names(names.into_iter(), "ALL").len(), 3);
    }
}
