//! The EE.log lines that say something about a screen with an overlay.
//!
//! EE.log lines start with the seconds since the game started the log, for
//! example `3594.988 Script [Info]: ThemedProjectionManager.lua:
//! PopulateInventoryGrid`. The log's first lines hold the start time
//! (`Current time: ... [UTC: Fri Nov 20 09:03:14 2026]`), so every line has a
//! wall-clock time. The game writes the file in bursts, often 15 to 30 s
//! after the fact, which is why each event keeps its own time.

use crate::signal::Millis;

/// A line in EE.log that matters for a screen with an overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogEvent {
    /// The relic list was filled: the relic selection or refinement screen
    /// opened.
    RelicListOpened,
    /// Every player voted, so the relic selection inside a mission closes.
    RelicVotesDone,
    /// The short countdown that follows a relic selection inside a mission
    /// started. The game writes it after every such selection, also when it
    /// writes no votes line.
    SelectionCountdown,
    /// The star chart takes input again: a relic selection opened from the
    /// star chart is over, picked or backed out of.
    StarChartInput,
    /// A level starts loading.
    LevelLoading,
    /// The mission ends.
    MissionEnding,
    /// The reward screen opened after a relic was cracked.
    RewardScreenOpened,
    /// The game asked the host for the squad's rewards.
    RewardsRequested,
    /// The reward screen closed.
    RewardScreenClosed,
    /// A riven reroll or unveil screen opened.
    RivenScreenOpened,
    /// The riven card was hidden.
    RivenCardsHidden,
    /// The orbiter scene loaded again, which also follows leaving the riven
    /// screen.
    OrbiterLoaded,
}

impl LogEvent {
    /// The part of the EE.log line that identifies the event, for log lines.
    pub const fn line(self) -> &'static str {
        match self {
            LogEvent::RelicListOpened => "ThemedProjectionManager.lua: PopulateInventoryGrid",
            LogEvent::RelicVotesDone => "We got all the votes so we can close now!",
            LogEvent::SelectionCountdown => "ProjectionsCountdown.lua: Initialize timer false",
            LogEvent::StarChartInput => "MapRedux input filter",
            LogEvent::LevelLoading => "GameRulesImpl SS_INVALID to SS_WAITING_TO_START",
            LogEvent::MissionEnding => "GameRulesImpl SS_STARTED to SS_ENDING",
            LogEvent::RewardScreenOpened => "VoidProjections: OpenVoidProjectionRewardScreen",
            LogEvent::RewardsRequested => "VoidProjections: GetVoidProjectionRewards",
            LogEvent::RewardScreenClosed => "Relic reward screen shut down",
            LogEvent::RivenScreenOpened => "OmegaRerollSelection",
            LogEvent::RivenCardsHidden => "DiegeticArtifactCards HudVis 0",
            LogEvent::OrbiterLoaded => "VolumetricFog render target",
        }
    }

    fn from_line(lower: &str) -> Option<LogEvent> {
        let has = |s: &str| lower.contains(s);
        // Not PopulateInventoryGridEnd, which follows right after.
        if lower
            .trim_end()
            .ends_with("themedprojectionmanager.lua: populateinventorygrid")
        {
            Some(LogEvent::RelicListOpened)
        } else if has("themedprojectionmanager.lua: we got all the votes") {
            Some(LogEvent::RelicVotesDone)
        } else if has("projectionscountdown.lua: initialize timer false") {
            Some(LogEvent::SelectionCountdown)
        } else if has("subscribing for /lotus/interface/mapredux.swf") && has("mapreduxinputfilter")
        {
            Some(LogEvent::StarChartInput)
        } else if has("gamerulesimpl - changing state from ss_invalid to") {
            Some(LogEvent::LevelLoading)
        } else if has("gamerulesimpl - changing state from ss_started to ss_ending") {
            Some(LogEvent::MissionEnding)
        } else if has("voidprojections: openvoidprojectionrewardscreen") {
            Some(LogEvent::RewardScreenOpened)
        } else if has("voidprojections: getvoidprojectionreward") {
            Some(LogEvent::RewardsRequested)
        } else if has("projectionrewardchoice.lua: relic reward screen shut down") {
            Some(LogEvent::RewardScreenClosed)
        } else if has("omegarerollselection.swf") || has("samodeusdioramaloaded") {
            Some(LogEvent::RivenScreenOpened)
        } else if (has("diegeticartifactcards.lua") || has("digeticartifactcards.lua"))
            && has("dbg: hudvis 0")
        {
            Some(LogEvent::RivenCardsHidden)
        } else if has("creating render target: /ee/materials/volumetricfog") {
            Some(LogEvent::OrbiterLoaded)
        } else {
            None
        }
    }
}

/// One event read from an EE.log line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogLine {
    /// Seconds since the game started the log.
    pub seconds: f64,
    pub event: LogEvent,
}

impl LogLine {
    /// The wall-clock time of the line, given the log's start time.
    pub fn time(&self, log_start: Millis) -> Millis {
        log_start + (self.seconds * 1000.0).round() as Millis
    }
}

/// The event in one EE.log line, if it has one.
pub fn parse_line(line: &str) -> Option<LogLine> {
    let lower = line.to_ascii_lowercase();
    let event = LogEvent::from_line(&lower)?;
    let seconds = lower.split_whitespace().next()?.parse().ok()?;
    Some(LogLine { seconds, event })
}

/// Every event in a piece of EE.log text, in the order the game wrote them.
pub fn parse_text(text: &str) -> Vec<LogLine> {
    text.lines().filter_map(parse_line).collect()
}

/// The log's start time from its `Current time:` line, which carries the
/// UTC time as `[UTC: Fri Nov 20 09:03:14 2026]`.
pub fn log_start(text: &str) -> Option<Millis> {
    let line = text.lines().find(|l| l.contains("Current time:"))?;
    let utc = line.split("[UTC:").nth(1)?.split(']').next()?.trim();
    // "Fri Nov 20 09:03:14 2026"
    let mut parts = utc.split_whitespace().skip(1);
    let month = month_number(parts.next()?)?;
    let day: u32 = parts.next()?.parse().ok()?;
    let mut clock = parts.next()?.split(':');
    let hour: i64 = clock.next()?.parse().ok()?;
    let minute: i64 = clock.next()?.parse().ok()?;
    let second: i64 = clock.next()?.parse().ok()?;
    let year: i64 = parts.next()?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

fn month_number(name: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS
        .iter()
        .position(|m| m.eq_ignore_ascii_case(name))
        .map(|i| i as u32 + 1)
}

/// Days since 1970-01-01 for a date in the proleptic Gregorian calendar
/// (Howard Hinnant's `days_from_civil`,
/// <https://howardhinnant.github.io/date_algorithms.html>).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(line: &str) -> Option<LogEvent> {
        parse_line(line).map(|l| l.event)
    }

    #[test]
    fn the_start_time_is_read_as_utc() {
        let head = "0.091 Sys [Diag]: Current time: Fri Nov 20 10:03:14 2026 [UTC: Fri Nov 20 09:03:14 2026]";
        // 2026-11-20T09:03:14Z
        assert_eq!(log_start(head), Some(1_795_165_394_000));
    }

    #[test]
    fn a_line_time_is_the_start_plus_its_seconds() {
        let line = parse_line(
            "3594.988 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid",
        )
        .unwrap();
        assert_eq!(line.time(1_000_000), 1_000_000 + 3_594_988);
    }

    #[test]
    fn relic_selection_lines() {
        assert_eq!(
            event("3594.988 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid"),
            Some(LogEvent::RelicListOpened)
        );
        assert_eq!(
            event("3595.000 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGridEnd"),
            None
        );
        assert_eq!(
            event("3608.726 Script [Info]: ThemedProjectionManager.lua: We got all the votes so we can close now!"),
            Some(LogEvent::RelicVotesDone)
        );
        assert_eq!(
            event("1107.806 Script [Info]: ProjectionsCountdown.lua: Initialize timer false	5"),
            Some(LogEvent::SelectionCountdown)
        );
        // The reward screen's countdown, and the other countdown steps.
        assert_eq!(
            event("1064.677 Script [Info]: ProjectionsCountdown.lua: Initialize timer true	5"),
            None
        );
        assert_eq!(
            event("1090.666 Script [Info]: ProjectionsCountdown.lua: Initialize timer nil	20"),
            None
        );
        assert_eq!(
            event("3294.955 Input [Info]: Subscribing for /Lotus/Interface/MapRedux.swf with input filter /EE/Types/Input/MapReduxInputFilter"),
            Some(LogEvent::StarChartInput)
        );
    }

    #[test]
    fn level_lines() {
        assert_eq!(
            event("3308.263 Net [Info]: GameRulesImpl - changing state from SS_INVALID to SS_WAITING_TO_START"),
            Some(LogEvent::LevelLoading)
        );
        assert_eq!(
            event(
                "3964.682 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING"
            ),
            Some(LogEvent::MissionEnding)
        );
        // The steps in between say nothing new.
        assert_eq!(
            event("3308.544 Net [Info]: GameRulesImpl - changing state from SS_STARTING to SS_WAITING_FOR_PLAYERS"),
            None
        );
    }

    #[test]
    fn reward_screen_lines() {
        assert_eq!(
            event("3574.266 Sys [Info]: VoidProjections: OpenVoidProjectionRewardScreen - PostMigration: 0"),
            Some(LogEvent::RewardScreenOpened)
        );
        assert_eq!(
            event("3579.272 Sys [Info]: VoidProjections: GetVoidProjectionRewards"),
            Some(LogEvent::RewardsRequested)
        );
        assert_eq!(
            event(
                "3594.949 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down"
            ),
            Some(LogEvent::RewardScreenClosed)
        );
        // Written after every vote too, without a reward screen.
        assert_eq!(
            event("3608.736 Script [Info]: ProjectionRewardChoice.lua: Relic rewards initialized"),
            None
        );
    }

    #[test]
    fn riven_lines() {
        assert_eq!(
            event("100.0 Sys [Info]: Created /Lotus/Interface/OmegaRerollSelection.swf"),
            Some(LogEvent::RivenScreenOpened)
        );
        assert_eq!(
            event("110.0 Script [Info]: DiegeticArtifactCards.lua: DBG: HudVis 0"),
            Some(LogEvent::RivenCardsHidden)
        );
        assert_eq!(
            event("120.0 Sys [Info]: Creating render target: /EE/Materials/VolumetricFogScatterTarget0"),
            Some(LogEvent::OrbiterLoaded)
        );
    }

    #[test]
    fn text_keeps_the_order_of_the_log() {
        let text =
            "3594.949 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down\n\
                    3594.962 Sys [Info]: VoidProjections: CloseVoidProjectionRewardScreen\n\
                    3594.988 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid\n";
        let events: Vec<_> = parse_text(text).into_iter().map(|l| l.event).collect();
        assert_eq!(
            events,
            [LogEvent::RewardScreenClosed, LogEvent::RelicListOpened]
        );
    }
}
