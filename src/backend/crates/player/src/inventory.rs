//! What the player has, with where each count comes from.

use std::collections::HashMap;

use crate::{catalogue_path, Millis};

/// Where a count comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Source {
    /// The inventory scan at `at`.
    Scan { at: Option<Millis> },
    /// A relic reward EE.log reported at `at`, after the last scan.
    Reward { at: Millis },
    /// A Foundry job building the item.
    Foundry,
}

/// One contribution to a count: how many of which item, from which source.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Evidence {
    /// The item counted, by name.
    pub item: String,
    pub count: i64,
    pub source: Source,
}

/// A count and what it was made from. An empty `from` with a total of 0
/// means no source lists the item.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct Count {
    pub total: i64,
    pub from: Vec<Evidence>,
}

impl Count {
    fn add(&mut self, evidence: Evidence) {
        if evidence.count != 0 {
            self.total += evidence.count;
            self.from.push(evidence);
        }
    }

    fn merge(&mut self, other: Count) {
        for e in other.from {
            self.add(e);
        }
    }

    /// "Chassis Blueprint 1 (scan 12:52) + Chassis 1 (reward 13:05)", or
    /// "none listed". `time` writes a time of day.
    pub fn explain(&self, time: &dyn Fn(Millis) -> String) -> String {
        if self.from.is_empty() {
            return "none listed".to_string();
        }
        self.from
            .iter()
            .map(|e| {
                let source = match e.source {
                    Source::Scan { at: Some(at) } => format!("scan {}", time(at)),
                    Source::Scan { at: None } => "saved scan".to_string(),
                    Source::Reward { at } => format!("reward {}", time(at)),
                    Source::Foundry => "Foundry".to_string(),
                };
                format!("{} {} ({source})", e.item, e.count)
            })
            .collect::<Vec<_>>()
            .join(" + ")
    }
}

/// The player's items: the last scan, the rewards reported since and the
/// Foundry jobs. Paths are catalogue paths.
#[derive(Debug, Clone, Default)]
pub struct Inventory {
    /// When the last scan finished; None for counts loaded from a saved scan.
    pub scan_at: Option<Millis>,
    /// Counts as the app holds them now: the scan plus the rewards since.
    pub counts: HashMap<String, i64>,
    /// Rewards since the scan: when, which item, how many.
    pub rewards: Vec<(Millis, String, i64)>,
    /// Foundry jobs per item.
    pub crafting: HashMap<String, i64>,
}

impl Inventory {
    /// How many of an item the player has, split into the scan and the
    /// rewards since. `name` labels the evidence.
    pub fn count(&self, path: &str, name: &str) -> Count {
        let path = catalogue_path(path);
        let now = self.counts.get(&path).copied().unwrap_or(0);
        let rewards: Vec<&(Millis, String, i64)> = self
            .rewards
            .iter()
            .filter(|(_, p, _)| catalogue_path(p) == path)
            .collect();
        let from_rewards: i64 = rewards.iter().map(|(_, _, n)| n).sum();
        let mut count = Count::default();
        count.add(Evidence {
            item: name.to_string(),
            count: now - from_rewards,
            source: Source::Scan { at: self.scan_at },
        });
        for (at, _, n) in rewards {
            count.add(Evidence {
                item: name.to_string(),
                count: *n,
                source: Source::Reward { at: *at },
            });
        }
        count
    }

    /// Foundry jobs building an item.
    pub fn in_foundry(&self, path: &str, name: &str) -> Count {
        let mut count = Count::default();
        count.add(Evidence {
            item: name.to_string(),
            count: self
                .crafting
                .get(&catalogue_path(path))
                .copied()
                .unwrap_or(0),
            source: Source::Foundry,
        });
        count
    }

    /// `count` plus Foundry jobs.
    pub fn usable(&self, path: &str, name: &str) -> Count {
        let mut count = self.count(path, name);
        count.merge(self.in_foundry(path, name));
        count
    }
}

/// Adds counts of several items.
pub(crate) fn sum(counts: impl IntoIterator<Item = Count>) -> Count {
    let mut total = Count::default();
    for c in counts {
        total.merge(c);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(at: Millis) -> String {
        format!("t{at}")
    }

    #[test]
    fn a_count_splits_into_the_scan_and_the_rewards_since() {
        let inventory = Inventory {
            scan_at: Some(100),
            counts: HashMap::from([("/Lotus/Types/A".to_string(), 3)]),
            rewards: vec![(150, "/Lotus/StoreItems/Types/A".to_string(), 1)],
            crafting: HashMap::new(),
        };
        let count = inventory.count("/Lotus/Types/A", "A");
        assert_eq!(count.total, 3);
        assert_eq!(count.explain(&time), "A 2 (scan t100) + A 1 (reward t150)");
    }

    #[test]
    fn an_item_no_source_lists() {
        let count = Inventory::default().usable("/Lotus/Types/B", "B");
        assert_eq!(count.total, 0);
        assert_eq!(count.explain(&time), "none listed");
    }
}
