/// One top-level section of the blob that the parser reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Section {
    /// The section's key in the blob.
    pub name: &'static str,
    /// What the section holds, which decides how it is read.
    pub kind: SectionKind,
    /// Every real account has this section. A blob without it lost its front
    /// in the capture and is rejected.
    pub core: bool,
}

/// What a section holds. Each kind has one reader, so a new section of a
/// known kind is one line in [`SECTIONS`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionKind {
    /// A single number.
    Scalar(Scalar),
    /// Items with their own state; each entry is one owned copy.
    Unique,
    /// Items with an `ItemCount`. `sockets` is set for Ayatan sculptures,
    /// which also carry how many sockets are filled.
    Stackable { sockets: bool },
    /// Unranked mods and unrevealed rivens, with an `ItemCount`.
    RawUpgrades,
    /// Ranked mods and revealed or unlocked rivens; each entry is one copy.
    Upgrades,
    /// Cosmetics such as glyphs, palettes and emotes; each entry is one copy.
    FlavourItems,
    /// Sigils and weapon skins; each entry is one copy.
    WeaponSkins,
    /// Affinity per item, also for items that are no longer owned.
    Mastery,
    /// Foundry jobs and when they complete.
    PendingRecipes,
    /// The Helminth, with the Warframes it consumed.
    Helminth,
}

/// The numbers the blob holds as top-level fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scalar {
    Credits,
    Endo,
    Platinum,
    FreePlatinum,
    MasteryRank,
}

const fn section(name: &'static str, kind: SectionKind) -> Section {
    Section {
        name,
        kind,
        core: false,
    }
}

const fn core(name: &'static str, kind: SectionKind) -> Section {
    Section {
        name,
        kind,
        core: true,
    }
}

/// Every section the parser reads, in the order it reads them. Items are
/// listed in this order, so unique items and stackable items keep the same
/// order from one blob to the next.
pub const SECTIONS: &[Section] = &[
    core("RegularCredits", SectionKind::Scalar(Scalar::Credits)),
    section("FusionPoints", SectionKind::Scalar(Scalar::Endo)),
    section("PremiumCredits", SectionKind::Scalar(Scalar::Platinum)),
    section(
        "PremiumCreditsFree",
        SectionKind::Scalar(Scalar::FreePlatinum),
    ),
    core("PlayerLevel", SectionKind::Scalar(Scalar::MasteryRank)),
    core("XPInfo", SectionKind::Mastery),
    core("Suits", SectionKind::Unique),
    section("LongGuns", SectionKind::Unique),
    section("Pistols", SectionKind::Unique),
    section("Melee", SectionKind::Unique),
    section("SpaceSuits", SectionKind::Unique),
    section("SpaceMelee", SectionKind::Unique),
    section("SpaceGuns", SectionKind::Unique),
    section("Sentinels", SectionKind::Unique),
    section("SentinelWeapons", SectionKind::Unique),
    section("KubrowPets", SectionKind::Unique),
    section("OperatorAmps", SectionKind::Unique),
    section("MechSuits", SectionKind::Unique),
    core("MiscItems", SectionKind::Stackable { sockets: false }),
    section("Recipes", SectionKind::Stackable { sockets: false }),
    section("FusionTreasures", SectionKind::Stackable { sockets: true }),
    section(
        "CrewShipRawSalvage",
        SectionKind::Stackable { sockets: false },
    ),
    section("ShipDecorations", SectionKind::Stackable { sockets: false }),
    core("RawUpgrades", SectionKind::RawUpgrades),
    section("Upgrades", SectionKind::Upgrades),
    section("FlavourItems", SectionKind::FlavourItems),
    section("WeaponSkins", SectionKind::WeaponSkins),
    section("PendingRecipes", SectionKind::PendingRecipes),
    section("InfestedFoundry", SectionKind::Helminth),
];

#[cfg(test)]
mod tests {
    use super::SECTIONS;

    #[test]
    fn every_section_is_listed_once() {
        let mut names: Vec<&str> = SECTIONS.iter().map(|s| s.name).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before);
    }
}
