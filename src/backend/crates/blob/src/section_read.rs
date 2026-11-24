use crate::{
    BlobInventory, BlobPendingRecipe, BlobRivenEntry, BlobStackableEntry, BlobUniqueEntry,
    ModCount, Scalar, Section, SectionKind,
};
use std::collections::HashMap;

/// Everything read from one blob, section by section.
#[derive(Debug, Clone, PartialEq)]
pub struct BlobRead {
    /// One entry per section in [`SECTIONS`](crate::SECTIONS), in that order.
    pub sections: Vec<SectionRead>,
    /// Every top-level key in the blob, including sections that are not read.
    pub keys: Vec<String>,
    /// The blob starts at its own opening brace. When it does not, its front
    /// was lost in the capture, and a missing section may only have been cut
    /// off.
    pub front_intact: bool,
}

/// What one section of the blob said.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionRead {
    pub section: Section,
    pub state: SectionState,
}

/// Whether a section could be read.
#[derive(Debug, Clone, PartialEq)]
pub enum SectionState {
    /// The blob does not have the section.
    Missing,
    /// The section is there, but its value has another shape than its kind
    /// expects. `expected` names the shape, such as "an array".
    Unreadable { expected: &'static str },
    /// The section was read completely.
    Read(SectionContent),
}

/// What a section that was read holds. Each section keeps its own share, so
/// two sections that count the same item (`RawUpgrades` and `Upgrades` for
/// mods) can be told apart.
#[derive(Debug, Clone, PartialEq)]
pub enum SectionContent {
    Scalar(i64),
    Unique(Vec<BlobUniqueEntry>),
    Stackable(Vec<BlobStackableEntry>),
    /// Mods and rivens from `RawUpgrades` or `Upgrades`.
    Upgrades {
        mods: HashMap<String, ModCount>,
        rivens: Vec<BlobRivenEntry>,
    },
    /// How often each item path occurs.
    Occurrences(HashMap<String, i64>),
    /// Mastery rank per item path.
    Mastery(HashMap<String, u32>),
    PendingRecipes(Vec<BlobPendingRecipe>),
    /// Warframe paths the Helminth consumed.
    ConsumedSuits(Vec<String>),
}

impl SectionContent {
    /// The content of a section of `kind` that holds nothing.
    pub fn empty(kind: SectionKind) -> Self {
        match kind {
            SectionKind::Scalar(_) => SectionContent::Scalar(0),
            SectionKind::Unique => SectionContent::Unique(Vec::new()),
            SectionKind::Stackable { .. } => SectionContent::Stackable(Vec::new()),
            SectionKind::RawUpgrades | SectionKind::Upgrades => SectionContent::Upgrades {
                mods: HashMap::new(),
                rivens: Vec::new(),
            },
            SectionKind::FlavourItems | SectionKind::WeaponSkins => {
                SectionContent::Occurrences(HashMap::new())
            }
            SectionKind::Mastery => SectionContent::Mastery(HashMap::new()),
            SectionKind::PendingRecipes => SectionContent::PendingRecipes(Vec::new()),
            SectionKind::Helminth => SectionContent::ConsumedSuits(Vec::new()),
        }
    }
}

impl BlobRead {
    /// The inventory these sections describe. A section that is missing or
    /// unreadable adds nothing, so its values are 0 or empty.
    ///
    /// `content_hash` is left at 0.
    pub fn to_inventory(&self) -> BlobInventory {
        let mut inv = BlobInventory {
            sections: self.keys.clone(),
            ..BlobInventory::default()
        };
        for read in &self.sections {
            let SectionState::Read(content) = &read.state else {
                continue;
            };
            add_to_inventory(read.section.kind, content, &mut inv);
        }
        inv
    }
}

fn add_to_inventory(kind: SectionKind, content: &SectionContent, inv: &mut BlobInventory) {
    match content {
        SectionContent::Scalar(v) => match kind {
            SectionKind::Scalar(Scalar::Credits) => inv.credits = *v,
            SectionKind::Scalar(Scalar::Endo) => inv.endo = *v,
            SectionKind::Scalar(Scalar::Platinum) => inv.platinum = *v,
            SectionKind::Scalar(Scalar::FreePlatinum) => inv.free_platinum = *v,
            SectionKind::Scalar(Scalar::MasteryRank) => inv.mastery_level = *v as u32,
            _ => {}
        },
        SectionContent::Unique(items) => inv.unique_items.extend(items.iter().cloned()),
        SectionContent::Stackable(items) => inv.stackable_items.extend(items.iter().cloned()),
        SectionContent::Upgrades { mods, rivens } => {
            for (path, mc) in mods {
                let sum = inv.mods.entry(path.clone()).or_default();
                sum.total += mc.total;
                for (rank, count) in &mc.by_rank {
                    *sum.by_rank.entry(*rank).or_insert(0) += count;
                }
            }
            inv.rivens.extend(rivens.iter().cloned());
        }
        SectionContent::Occurrences(counts) => {
            let into = if kind == SectionKind::WeaponSkins {
                &mut inv.weapon_skins
            } else {
                &mut inv.flavour_items
            };
            for (path, count) in counts {
                *into.entry(path.clone()).or_insert(0) += count;
            }
        }
        SectionContent::Mastery(ranks) => inv
            .mastery_data
            .extend(ranks.iter().map(|(k, v)| (k.clone(), *v))),
        SectionContent::PendingRecipes(recipes) => {
            inv.pending_recipes.extend(recipes.iter().cloned());
        }
        SectionContent::ConsumedSuits(suits) => inv.consumed_suits.extend(suits.iter().cloned()),
    }
}
