//! The account as the scans have shown it, section by section.
//!
//! Each blob updates only the sections it holds. A section that was read
//! replaces what was known about it; a section that is missing or unreadable
//! keeps its previous values, so no item disappears because its section was
//! not read. A section is taken as empty only when [`EMPTY_AFTER`] blobs in a
//! row with an intact front lack it, because the game can leave out a section
//! that has nothing in it.

use std::collections::BTreeMap;

use hexdesk_blob::{
    BlobInventory, BlobRead, Section, SectionContent, SectionRead, SectionState, SECTIONS,
};

use crate::Millis;

/// Blobs in a row with an intact front that must lack a section before it is
/// taken as empty. At the scan interval of about 10 s this is half a minute.
pub const EMPTY_AFTER: u32 = 3;

/// What was last read from each section, and when.
#[derive(Debug, Clone, Default)]
pub struct ScanState {
    known: BTreeMap<&'static str, Known>,
}

#[derive(Debug, Clone)]
struct Known {
    section: Section,
    content: SectionContent,
    read_at: Millis,
    /// Blobs in a row with an intact front that lacked the section.
    missing_streak: u32,
}

/// What one blob did to one section.
#[derive(Debug, Clone, PartialEq)]
pub enum SectionOutcome {
    /// Read, with content that differs from what was known, or read for the
    /// first time.
    Updated,
    /// Read, with the same content as before; or missing while it already
    /// held nothing.
    Unchanged,
    /// Missing from a blob with an intact front; the previous values are
    /// kept. `streak` counts the blobs in a row that lacked it.
    KeptMissing { streak: u32 },
    /// Missing from a blob that lost its front; the previous values are kept.
    KeptFrontLost,
    /// The section has another shape than its kind expects; the previous
    /// values are kept.
    KeptUnreadable { expected: &'static str },
    /// Missing from [`EMPTY_AFTER`] blobs in a row with an intact front, so
    /// it now holds nothing.
    Emptied,
    /// Missing or unreadable, and nothing was known about it.
    NotSeen,
}

/// What one blob did, per section in [`SECTIONS`] order.
#[derive(Debug, Clone, PartialEq)]
pub struct ScanOutcome {
    pub sections: Vec<(&'static str, SectionOutcome)>,
}

impl ScanOutcome {
    /// Whether the blob changed anything the inventory shows.
    pub fn changed(&self) -> bool {
        self.sections
            .iter()
            .any(|(_, o)| matches!(o, SectionOutcome::Updated | SectionOutcome::Emptied))
    }

    /// The sections with a given outcome, for the log.
    pub fn named(&self, pick: impl Fn(&SectionOutcome) -> bool) -> Vec<&'static str> {
        self.sections
            .iter()
            .filter(|(_, o)| pick(o))
            .map(|(name, _)| *name)
            .collect()
    }
}

impl ScanState {
    /// Applies one blob, read at `at`.
    pub fn apply(&mut self, read: &BlobRead, at: Millis) -> ScanOutcome {
        let sections = read
            .sections
            .iter()
            .map(|r| (r.section.name, self.apply_section(r, read.front_intact, at)))
            .collect();
        ScanOutcome { sections }
    }

    fn apply_section(
        &mut self,
        read: &SectionRead,
        front_intact: bool,
        at: Millis,
    ) -> SectionOutcome {
        let name = read.section.name;
        match &read.state {
            SectionState::Read(content) => match self.known.get_mut(name) {
                Some(known) => {
                    known.read_at = at;
                    known.missing_streak = 0;
                    if known.content == *content {
                        SectionOutcome::Unchanged
                    } else {
                        known.content = content.clone();
                        SectionOutcome::Updated
                    }
                }
                None => {
                    self.known.insert(
                        name,
                        Known {
                            section: read.section,
                            content: content.clone(),
                            read_at: at,
                            missing_streak: 0,
                        },
                    );
                    SectionOutcome::Updated
                }
            },
            SectionState::Unreadable { expected } => match self.known.get_mut(name) {
                // The section is there, so the game did not leave it out.
                Some(known) => {
                    known.missing_streak = 0;
                    SectionOutcome::KeptUnreadable { expected }
                }
                None => SectionOutcome::NotSeen,
            },
            SectionState::Missing => {
                let Some(known) = self.known.get_mut(name) else {
                    return SectionOutcome::NotSeen;
                };
                let empty = SectionContent::empty(known.section.kind);
                if known.content == empty {
                    return SectionOutcome::Unchanged;
                }
                if !front_intact {
                    return SectionOutcome::KeptFrontLost;
                }
                known.missing_streak += 1;
                if known.missing_streak < EMPTY_AFTER {
                    return SectionOutcome::KeptMissing {
                        streak: known.missing_streak,
                    };
                }
                known.missing_streak = 0;
                known.read_at = at;
                known.content = empty;
                SectionOutcome::Emptied
            }
        }
    }

    /// When a section was last read, or taken as empty.
    pub fn read_at(&self, name: &str) -> Option<Millis> {
        self.known.get(name).map(|k| k.read_at)
    }

    /// The inventory all known sections describe together. A section that
    /// was never read adds nothing.
    pub fn to_inventory(&self) -> BlobInventory {
        let sections = SECTIONS
            .iter()
            .map(|section| SectionRead {
                section: *section,
                state: match self.known.get(section.name) {
                    Some(known) => SectionState::Read(known.content.clone()),
                    None => SectionState::Missing,
                },
            })
            .collect();
        BlobRead {
            sections,
            keys: Vec::new(),
            front_intact: true,
        }
        .to_inventory()
    }
}

/// [`ScanState`] in a form that can be saved, so a restart continues from
/// what the scans have shown instead of from nothing.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SavedScan {
    /// Per section name.
    pub sections: BTreeMap<String, SavedSection>,
}

/// One section of a [`SavedScan`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SavedSection {
    pub content: SectionContent,
    pub read_at: Millis,
    #[serde(default)]
    pub missing_streak: u32,
}

impl ScanState {
    /// The state in a form that can be saved.
    pub fn to_saved(&self) -> SavedScan {
        SavedScan {
            sections: self
                .known
                .iter()
                .map(|(name, known)| {
                    (
                        (*name).to_string(),
                        SavedSection {
                            content: known.content.clone(),
                            read_at: known.read_at,
                            missing_streak: known.missing_streak,
                        },
                    )
                })
                .collect(),
        }
    }

    /// The state a [`SavedScan`] describes, and the names of the saved
    /// sections it leaves out: sections that are no longer in [`SECTIONS`],
    /// or whose content does not fit their kind.
    pub fn from_saved(saved: SavedScan) -> (Self, Vec<String>) {
        let mut state = ScanState::default();
        let mut dropped = Vec::new();
        for (name, saved) in saved.sections {
            let Some(section) = SECTIONS.iter().find(|s| s.name == name) else {
                dropped.push(name);
                continue;
            };
            if !saved.content.fits(section.kind) {
                dropped.push(name);
                continue;
            }
            state.known.insert(
                section.name,
                Known {
                    section: *section,
                    content: saved.content,
                    read_at: saved.read_at,
                    missing_streak: saved.missing_streak,
                },
            );
        }
        (state, dropped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hexdesk_blob::{BlobStackableEntry, ModCount};
    use std::collections::HashMap;

    const ALLOY: &str = "/Lotus/Types/Items/MiscItems/Alloy";
    const POLYMER: &str = "/Lotus/Types/Items/MiscItems/Polymer";
    const BLUEPRINT: &str = "/Lotus/Types/Recipes/Weapons/SomaBlueprint";
    const SERRATION: &str = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";

    fn stack(items: &[(&str, i64)]) -> SectionState {
        SectionState::Read(SectionContent::Stackable(
            items
                .iter()
                .map(|(path, count)| BlobStackableEntry {
                    item_type: path.to_string(),
                    item_count: *count,
                    sockets: None,
                })
                .collect(),
        ))
    }

    fn mods(count: i64) -> SectionState {
        SectionState::Read(SectionContent::Upgrades {
            mods: HashMap::from([(
                SERRATION.to_string(),
                ModCount {
                    total: count,
                    by_rank: HashMap::from([(0, count)]),
                },
            )]),
            rivens: Vec::new(),
        })
    }

    /// A blob that has only the given sections; every other one is missing.
    fn blob(front_intact: bool, given: Vec<(&str, SectionState)>) -> BlobRead {
        let mut given: HashMap<&str, SectionState> = given.into_iter().collect();
        BlobRead {
            sections: SECTIONS
                .iter()
                .map(|section| SectionRead {
                    section: *section,
                    state: given.remove(section.name).unwrap_or(SectionState::Missing),
                })
                .collect(),
            keys: Vec::new(),
            front_intact,
        }
    }

    /// A blob with both stackable sections of [`start`].
    fn full() -> BlobRead {
        blob(
            true,
            vec![
                ("MiscItems", stack(&[(ALLOY, 100), (POLYMER, 5)])),
                ("Recipes", stack(&[(BLUEPRINT, 1)])),
            ],
        )
    }

    /// A blob like [`full`] without Recipes.
    fn without_recipes(front_intact: bool) -> BlobRead {
        blob(
            front_intact,
            vec![("MiscItems", stack(&[(ALLOY, 100), (POLYMER, 5)]))],
        )
    }

    fn outcome<'a>(outcome: &'a ScanOutcome, name: &str) -> &'a SectionOutcome {
        &outcome
            .sections
            .iter()
            .find(|(n, _)| *n == name)
            .expect("section is in the table")
            .1
    }

    fn count(state: &ScanState, path: &str) -> Option<i64> {
        state
            .to_inventory()
            .stackable_items
            .iter()
            .find(|e| e.item_type == path)
            .map(|e| e.item_count)
    }

    fn start() -> ScanState {
        let mut state = ScanState::default();
        state.apply(&full(), 1);
        state
    }

    #[test]
    fn a_blob_without_a_section_still_updates_the_others() {
        let mut state = start();
        let out = state.apply(
            &blob(
                true,
                vec![("MiscItems", stack(&[(ALLOY, 120), (POLYMER, 5)]))],
            ),
            2,
        );
        assert_eq!(outcome(&out, "MiscItems"), &SectionOutcome::Updated);
        assert_eq!(
            outcome(&out, "Recipes"),
            &SectionOutcome::KeptMissing { streak: 1 }
        );
        assert!(out.changed());
        assert_eq!(count(&state, ALLOY), Some(120));
        assert_eq!(count(&state, BLUEPRINT), Some(1));
        assert_eq!(state.read_at("MiscItems"), Some(2));
        assert_eq!(state.read_at("Recipes"), Some(1));
    }

    #[test]
    fn an_item_used_up_disappears_once_its_section_is_read() {
        let mut state = start();
        state.apply(
            &blob(
                true,
                vec![
                    ("MiscItems", stack(&[(ALLOY, 100)])),
                    ("Recipes", stack(&[(BLUEPRINT, 1)])),
                ],
            ),
            2,
        );
        assert_eq!(count(&state, POLYMER), None);
        assert_eq!(count(&state, ALLOY), Some(100));
    }

    #[test]
    fn a_blob_that_lost_its_front_never_empties_a_section() {
        let mut state = start();
        for at in 2..2 + 2 * Millis::from(EMPTY_AFTER) {
            let out = state.apply(&without_recipes(false), at);
            assert_eq!(outcome(&out, "Recipes"), &SectionOutcome::KeptFrontLost);
        }
        assert_eq!(count(&state, BLUEPRINT), Some(1));
    }

    #[test]
    fn a_section_that_comes_back_starts_counting_again() {
        let mut state = start();
        let mut at = 2;
        for _ in 1..EMPTY_AFTER {
            state.apply(&without_recipes(true), at);
            at += 1;
        }
        let out = state.apply(&full(), at);
        assert_eq!(outcome(&out, "Recipes"), &SectionOutcome::Unchanged);
        assert!(!out.changed());
        for streak in 1..EMPTY_AFTER {
            at += 1;
            let out = state.apply(&without_recipes(true), at);
            assert_eq!(
                outcome(&out, "Recipes"),
                &SectionOutcome::KeptMissing { streak }
            );
        }
        assert_eq!(count(&state, BLUEPRINT), Some(1));
    }

    #[test]
    fn a_section_missing_from_enough_complete_blobs_is_taken_as_empty() {
        let mut state = start();
        let mut last = None;
        for at in 0..EMPTY_AFTER {
            last = Some(state.apply(&without_recipes(true), 2 + Millis::from(at)));
        }
        let out = last.unwrap();
        assert_eq!(outcome(&out, "Recipes"), &SectionOutcome::Emptied);
        assert!(out.changed());
        assert_eq!(count(&state, BLUEPRINT), None);

        let again = state.apply(&without_recipes(true), 10);
        assert_eq!(outcome(&again, "Recipes"), &SectionOutcome::Unchanged);
    }

    #[test]
    fn a_blob_that_lost_its_front_does_not_break_the_streak() {
        let mut state = start();
        state.apply(&without_recipes(true), 2);
        state.apply(&without_recipes(false), 3);
        let out = state.apply(&without_recipes(true), 4);
        assert_eq!(
            outcome(&out, "Recipes"),
            &SectionOutcome::KeptMissing { streak: 2 }
        );
    }

    #[test]
    fn an_unreadable_section_keeps_its_items_and_resets_the_streak() {
        let mut state = start();
        state.apply(&without_recipes(true), 2);
        let unreadable = blob(
            true,
            vec![(
                "Recipes",
                SectionState::Unreadable {
                    expected: "an array",
                },
            )],
        );
        let out = state.apply(&unreadable, 3);
        assert_eq!(
            outcome(&out, "Recipes"),
            &SectionOutcome::KeptUnreadable {
                expected: "an array"
            }
        );
        let out = state.apply(&without_recipes(true), 4);
        assert_eq!(
            outcome(&out, "Recipes"),
            &SectionOutcome::KeptMissing { streak: 1 }
        );
        assert_eq!(count(&state, BLUEPRINT), Some(1));
    }

    #[test]
    fn the_same_blob_twice_changes_nothing() {
        let mut state = start();
        let out = state.apply(&full(), 2);
        assert!(!out.changed());
        assert_eq!(
            out.named(|o| *o == SectionOutcome::Unchanged),
            ["MiscItems", "Recipes"]
        );
        assert_eq!(state.read_at("Recipes"), Some(2));
    }

    #[test]
    fn mods_add_up_over_both_upgrade_sections_and_each_is_kept_on_its_own() {
        let total = |state: &ScanState| state.to_inventory().mods[SERRATION].total;
        let mut state = ScanState::default();
        state.apply(
            &blob(true, vec![("RawUpgrades", mods(3)), ("Upgrades", mods(2))]),
            1,
        );
        assert_eq!(total(&state), 5);
        state.apply(&blob(true, vec![("RawUpgrades", mods(3))]), 2);
        assert_eq!(total(&state), 5);
        state.apply(
            &blob(true, vec![("RawUpgrades", mods(3)), ("Upgrades", mods(1))]),
            3,
        );
        assert_eq!(total(&state), 4);
    }

    #[test]
    fn a_section_never_read_adds_nothing() {
        let mut state = ScanState::default();
        let out = state.apply(&blob(true, vec![("MiscItems", stack(&[(ALLOY, 1)]))]), 1);
        assert_eq!(outcome(&out, "Recipes"), &SectionOutcome::NotSeen);
        assert_eq!(state.read_at("Recipes"), None);
        assert_eq!(state.to_inventory().stackable_items.len(), 1);
    }

    #[test]
    fn a_saved_state_continues_where_it_stopped() {
        let mut state = start();
        state.apply(&without_recipes(true), 2);
        let (restored, dropped) = ScanState::from_saved(state.to_saved());
        assert!(dropped.is_empty());
        assert_eq!(restored.to_inventory(), state.to_inventory());
        assert_eq!(restored.read_at("Recipes"), Some(1));

        // The streak continues too: two more blobs without Recipes empty it.
        let mut restored = restored;
        restored.apply(&without_recipes(true), 3);
        let out = restored.apply(&without_recipes(true), 4);
        assert_eq!(outcome(&out, "Recipes"), &SectionOutcome::Emptied);
    }

    #[test]
    fn a_saved_section_that_is_unknown_or_does_not_fit_is_left_out() {
        let mut saved = start().to_saved();
        let misc = saved.sections["MiscItems"].clone();
        saved
            .sections
            .insert("NoSuchSection".to_string(), misc.clone());
        saved.sections.insert(
            "RegularCredits".to_string(),
            SavedSection {
                content: misc.content.clone(),
                ..misc
            },
        );
        let (state, mut dropped) = ScanState::from_saved(saved);
        dropped.sort();
        assert_eq!(dropped, ["NoSuchSection", "RegularCredits"]);
        assert_eq!(count(&state, ALLOY), Some(100));
        assert_eq!(state.read_at("RegularCredits"), None);
    }
}
