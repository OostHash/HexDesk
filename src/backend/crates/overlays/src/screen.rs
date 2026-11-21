//! The game screens that have an overlay.

/// A game screen with an overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Screen {
    /// "VOID FISSURE/SELECT RELIC" before or during a fissure mission.
    RelicSelection,
    /// "VOID RELICS/REFINEMENT" in the orbiter.
    RelicRefinement,
    /// "VOID FISSURE/REWARDS": the squad's reward cards after a relic opened.
    RewardChoice,
    /// A riven card: the reroll screen, or "INVENTORY/MODS".
    Riven,
}

impl Screen {
    /// Every screen, in a fixed order.
    pub const ALL: [Screen; 4] = [
        Screen::RelicSelection,
        Screen::RelicRefinement,
        Screen::RewardChoice,
        Screen::Riven,
    ];

    /// The overlay shown on this screen.
    pub const fn overlay(self) -> Overlay {
        match self {
            Screen::RelicSelection | Screen::RelicRefinement => Overlay::RelicPick,
            Screen::RewardChoice => Overlay::RelicReward,
            Screen::Riven => Overlay::Riven,
        }
    }

    /// The name used in log lines.
    pub const fn name(self) -> &'static str {
        match self {
            Screen::RelicSelection => "relic selection",
            Screen::RelicRefinement => "relic refinement",
            Screen::RewardChoice => "fissure rewards",
            Screen::Riven => "riven",
        }
    }

    /// How long the screen is taken to be up when nothing reports that it
    /// closed. The relic selection has a 20 s vote timer and the reward
    /// choice a 15 s one, so these limits only end a visit whose close
    /// signal was missed.
    pub const fn time_limit_ms(self) -> i64 {
        match self {
            Screen::RelicSelection => 120_000,
            Screen::RelicRefinement => 600_000,
            Screen::RewardChoice => 60_000,
            Screen::Riven => 600_000,
        }
    }
}

/// An overlay window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Overlay {
    /// The relics most worth running, on the relic selection screen.
    RelicPick,
    /// Prices of the reward cards, on the reward screen.
    RelicReward,
    /// The riven check.
    Riven,
}

impl Overlay {
    /// The name used in log lines and settings.
    pub const fn name(self) -> &'static str {
        match self {
            Overlay::RelicPick => "relic_pick",
            Overlay::RelicReward => "relic_reward",
            Overlay::Riven => "riven",
        }
    }

    pub(crate) const fn index(self) -> usize {
        match self {
            Overlay::RelicPick => 0,
            Overlay::RelicReward => 1,
            Overlay::Riven => 2,
        }
    }
}
