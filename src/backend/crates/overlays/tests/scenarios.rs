//! Scenarios from real sessions. EE.log times are the seconds the game wrote
//! in front of each line; a title read by the overlay key gets the time of
//! the key press on the same clock.

use hexdesk_overlays::ee_log::{parse_text, LogEvent};
use hexdesk_overlays::tracker::CloseReason;
use hexdesk_overlays::{
    Action, Decision, HideBy, Ignored, LeaveReason, Millis, Overlay, Screen, Signal, Step, Tracker,
};

fn ms(seconds: f64) -> Millis {
    (seconds * 1000.0).round() as Millis
}

fn log(seconds: f64, event: LogEvent) -> Signal {
    Signal::log(ms(seconds), event)
}

fn title(seconds: f64, screen: Option<Screen>) -> Signal {
    Signal::title(ms(seconds), screen)
}

fn observed_title(seconds: f64, screen: Option<Screen>) -> Signal {
    Signal::observed_title(ms(seconds), screen)
}

/// Signals for a piece of EE.log as one read of the file returns it.
fn read(text: &str) -> Vec<Signal> {
    parse_text(text)
        .into_iter()
        .map(|line| Signal::log(line.time(0), line.event))
        .collect()
}

fn opens(step: &Step) -> Vec<(u64, Overlay)> {
    step.actions
        .iter()
        .filter_map(|a| match a {
            Action::Open { visit, overlay } => Some((visit.id, *overlay)),
            _ => None,
        })
        .collect()
}

fn closes(step: &Step) -> Vec<(u64, Overlay, CloseReason)> {
    step.actions
        .iter()
        .filter_map(|a| match a {
            Action::Close {
                visit,
                overlay,
                reason,
            } => Some((*visit, *overlay, *reason)),
            _ => None,
        })
        .collect()
}

fn decisions(step: &Step) -> Vec<Decision> {
    step.decisions.iter().map(|(_, d)| *d).collect()
}

fn screen_now(tracker: &Tracker) -> Option<Screen> {
    tracker.current().map(|v| v.screen)
}

#[test]
fn a_relic_picked_from_the_star_chart() {
    let mut tracker = Tracker::new();
    let step = tracker.handle(&read(
        "3280.280 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid\n\
         3280.281 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid\n",
    ));
    assert_eq!(opens(&step), [(1, Overlay::RelicPick)]);
    assert_eq!(
        decisions(&step)[1],
        Decision::Ignored(Ignored::SameVisit),
        "the doubled line is the same screen"
    );

    let step = tracker.handle(&read(
        "3294.955 Input [Info]: Subscribing for /Lotus/Interface/MapRedux.swf with input filter /EE/Types/Input/MapReduxInputFilter\n\
         3308.263 Net [Info]: GameRulesImpl - changing state from SS_INVALID to SS_WAITING_TO_START\n",
    ));
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
    assert_eq!(
        decisions(&step)[1],
        Decision::Ignored(Ignored::NotOnThatScreen)
    );
    assert_eq!(screen_now(&tracker), None);
}

#[test]
fn rounds_of_an_endless_fissure() {
    // EE.log as it arrived in a run: the reward screen, then the relic
    // selection inside the mission, closed by the votes line.
    let mut tracker = Tracker::new();
    let step = tracker.handle(&read(
        "3574.266 Sys [Info]: VoidProjections: OpenVoidProjectionRewardScreen - PostMigration: 0\n\
         3579.258 Script [Info]: ProjectionsCountdown.lua: Relic timer closed\n\
         3579.272 Sys [Info]: VoidProjections: GetVoidProjectionRewards\n",
    ));
    assert_eq!(opens(&step), [(1, Overlay::RelicReward)]);

    let step = tracker.handle(&read(
        "3594.949 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down\n\
         3594.962 Sys [Info]: VoidProjections: CloseVoidProjectionRewardScreen\n\
         3594.988 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid\n\
         3594.989 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid\n",
    ));
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicReward,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
    assert_eq!(opens(&step), [(2, Overlay::RelicPick)]);

    let step = tracker.handle(&read(
        "3608.726 Script [Info]: ThemedProjectionManager.lua: We got all the votes so we can close now!\n\
         3608.736 Script [Info]: ProjectionRewardChoice.lua: Relic rewards initialized\n\
         3613.736 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down\n",
    ));
    assert_eq!(
        closes(&step),
        [(
            2,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
    assert!(opens(&step).is_empty());
    assert_eq!(screen_now(&tracker), None);
}

#[test]
fn background_title_ocr_keeps_rewards_open_then_switches_to_relic_pick() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RewardScreenOpened)]);

    let step = tracker.handle(&[observed_title(5.0, Some(Screen::RewardChoice))]);
    assert!(step.actions.is_empty());
    assert_eq!(decisions(&step), [Decision::Ignored(Ignored::SameVisit)]);

    let step = tracker.handle(&[observed_title(10.0, Some(Screen::RelicSelection))]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicReward,
            CloseReason::Left(LeaveReason::Replaced)
        )]
    );
    assert_eq!(opens(&step), [(2, Overlay::RelicPick)]);
}

#[test]
fn background_title_ocr_closes_rewards_after_repeated_misses() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RewardScreenOpened)]);

    let step = tracker.handle(&[observed_title(10.0, None)]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicReward,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
    assert_eq!(screen_now(&tracker), None);
}

#[test]
fn a_selection_in_a_mission_without_a_votes_line_closes_on_the_countdown() {
    // EE.log as it arrived in a run where the game wrote no votes line.
    let mut tracker = Tracker::new();
    tracker.handle(&read(
        "1089.328 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid
         1089.329 Script [Info]: ThemedProjectionManager.lua: PopulateInventoryGrid
",
    ));
    let step = tracker.handle(&read(
        "1107.805 Script [Info]: ProjectionsCountdown.lua: Initialize timer nil	0
         1107.806 Script [Info]: ProjectionsCountdown.lua: Initialize timer false	5
         1112.813 Script [Info]: ProjectionRewardChoice.lua: Reward choice force closed
         1112.813 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down
",
    ));
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
    assert_eq!(screen_now(&tracker), None);
}

#[test]
fn the_overlay_key_is_ahead_of_ee_log() {
    let mut tracker = Tracker::new();
    // The key reads the relic list title while EE.log has not been written.
    let step = tracker.handle(&[title(3600.0, Some(Screen::RelicSelection))]);
    assert_eq!(opens(&step), [(1, Overlay::RelicPick)]);

    // The lines arrive later, written before the key press.
    let step = tracker.handle(&[
        log(3594.949, LogEvent::RewardScreenClosed),
        log(3594.988, LogEvent::RelicListOpened),
    ]);
    assert!(step.actions.is_empty());
    assert_eq!(
        decisions(&step),
        [
            Decision::Ignored(Ignored::NotOnThatScreen),
            Decision::Ignored(Ignored::SameVisit)
        ]
    );
}

#[test]
fn a_late_line_does_not_bring_back_an_overlay_the_key_hid() {
    let mut tracker = Tracker::new();
    tracker.handle(&[title(100.0, Some(Screen::RelicSelection))]);
    let step = tracker.handle(&[Signal::hide(ms(105.0), HideBy::Key)]);
    assert_eq!(
        closes(&step),
        [(1, Overlay::RelicPick, CloseReason::Player)]
    );

    let step = tracker.handle(&[log(98.0, LogEvent::RelicListOpened)]);
    assert!(step.actions.is_empty());

    // Reading the title again shows it again, read afresh.
    let step = tracker.handle(&[title(110.0, Some(Screen::RelicSelection))]);
    assert_eq!(decisions(&step), [Decision::ShownAgain { visit: 1 }]);
    assert_eq!(opens(&step), [(1, Overlay::RelicPick)]);
}

#[test]
fn a_close_written_before_the_player_hid_the_overlay_still_ends_the_visit() {
    // As in a test run: the key hid the overlay at 105 s, and the line that
    // the screen closed, written at 103 s, arrived after that.
    let mut tracker = Tracker::new();
    tracker.handle(&[title(100.0, Some(Screen::RelicSelection))]);
    tracker.handle(&[Signal::hide(ms(105.0), HideBy::Key)]);
    let step = tracker.handle(&[log(103.0, LogEvent::StarChartInput)]);
    assert!(matches!(
        decisions(&step)[0],
        Decision::Left {
            reason: LeaveReason::Closed,
            ..
        }
    ));
    assert!(step.actions.is_empty(), "the overlay was already hidden");
    assert_eq!(screen_now(&tracker), None);
}

#[test]
fn an_open_written_before_the_player_hid_the_overlay_keeps_it_hidden() {
    let mut tracker = Tracker::new();
    tracker.handle(&[title(100.0, Some(Screen::RelicSelection))]);
    tracker.handle(&[Signal::hide(ms(110.0), HideBy::CloseButton)]);
    let step = tracker.handle(&[log(108.0, LogEvent::RelicListOpened)]);
    assert_eq!(decisions(&step), [Decision::Ignored(Ignored::SameVisit)]);
    assert!(step.actions.is_empty());
}

#[test]
fn a_screen_that_opened_and_closed_within_one_read_is_not_shown() {
    let mut tracker = Tracker::new();
    let step = tracker.handle(&[
        log(10.0, LogEvent::RelicListOpened),
        log(25.0, LogEvent::RelicVotesDone),
    ]);
    assert!(matches!(decisions(&step)[0], Decision::Entered { .. }));
    assert!(matches!(decisions(&step)[1], Decision::Left { .. }));
    assert!(step.actions.is_empty());
}

#[test]
fn a_new_relic_list_after_a_missed_close_starts_a_new_visit() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RelicListOpened)]);
    let step = tracker.handle(&[log(100.0, LogEvent::RelicListOpened)]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::Reopened)
        )]
    );
    assert_eq!(opens(&step), [(2, Overlay::RelicPick)]);
}

#[test]
fn another_screen_replaces_the_current_one() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RelicListOpened)]);
    let step = tracker.handle(&[log(30.0, LogEvent::RewardScreenOpened)]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::Replaced)
        )]
    );
    assert_eq!(opens(&step), [(2, Overlay::RelicReward)]);
}

#[test]
fn an_older_line_cannot_replace_a_newer_screen() {
    let mut tracker = Tracker::new();
    tracker.handle(&[title(50.0, Some(Screen::RewardChoice))]);
    let step = tracker.handle(&[log(40.0, LogEvent::RelicListOpened)]);
    assert_eq!(
        decisions(&step),
        [Decision::Ignored(Ignored::OlderThanState {
            state_at: ms(50.0)
        })]
    );
    assert_eq!(screen_now(&tracker), Some(Screen::RewardChoice));
}

#[test]
fn a_late_line_cannot_reopen_a_screen_that_closed_after_it() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RewardScreenOpened)]);
    tracker.handle(&[log(20.0, LogEvent::RewardScreenClosed)]);
    let step = tracker.handle(&[log(5.0, LogEvent::RewardsRequested)]);
    assert_eq!(
        decisions(&step),
        [Decision::Ignored(Ignored::ScreenLeftSince {
            left_at: ms(20.0)
        })]
    );
}

#[test]
fn the_time_limit_ends_a_visit_whose_close_was_missed() {
    let mut tracker = Tracker::new();
    let step = tracker.handle(&[log(0.0, LogEvent::RelicListOpened)]);
    assert!(step.actions.contains(&Action::Timer {
        visit: 1,
        at: 120_000
    }));

    let step = tracker.handle(&[Signal::timeout(120_000, 1)]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicPick,
            CloseReason::Left(LeaveReason::TimeLimit)
        )]
    );
    let step = tracker.handle(&[Signal::timeout(130_000, 1)]);
    assert_eq!(
        decisions(&step),
        [Decision::Ignored(Ignored::VisitAlreadyOver)]
    );
}

#[test]
fn a_turned_off_overlay_is_not_opened_but_its_screen_is_tracked() {
    let mut tracker = Tracker::new();
    tracker.set_overlay_on(Overlay::RelicPick, false);
    let step = tracker.handle(&[log(0.0, LogEvent::RelicListOpened)]);
    assert!(opens(&step).is_empty());
    assert!(matches!(
        decisions(&step)[0],
        Decision::Entered {
            overlay_on: false,
            ..
        }
    ));
    assert_eq!(screen_now(&tracker), Some(Screen::RelicSelection));
}

#[test]
fn turning_an_overlay_off_hides_it() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RelicListOpened)]);
    assert_eq!(
        tracker.set_overlay_on(Overlay::RelicPick, false),
        [Action::Close {
            visit: 1,
            overlay: Overlay::RelicPick,
            reason: CloseReason::TurnedOff
        }]
    );
}

#[test]
fn a_riven_close_line_right_after_the_open_is_ignored() {
    let mut tracker = Tracker::new();
    tracker.handle(&[log(0.0, LogEvent::RivenScreenOpened)]);
    let step = tracker.handle(&[log(0.5, LogEvent::RivenCardsHidden)]);
    assert_eq!(
        decisions(&step),
        [Decision::Ignored(Ignored::TooSoonAfterOpen)]
    );
    let step = tracker.handle(&[log(5.0, LogEvent::OrbiterLoaded)]);
    assert_eq!(
        closes(&step),
        [(1, Overlay::Riven, CloseReason::Left(LeaveReason::Closed))]
    );
}

#[test]
fn an_unrecognised_title_or_a_hide_with_nothing_up_changes_nothing() {
    let mut tracker = Tracker::new();
    let step = tracker.handle(&[title(1.0, None), Signal::hide(ms(2.0), HideBy::CloseButton)]);
    assert_eq!(
        decisions(&step),
        [
            Decision::Ignored(Ignored::TitleNotRecognised),
            Decision::Ignored(Ignored::NothingToHide)
        ]
    );
    assert!(step.actions.is_empty());
}

#[test]
fn manual_mode_opens_only_on_the_overlay_key_and_still_closes_on_ee_log() {
    let mut tracker = Tracker::new();
    tracker.set_manual(true);
    let step = tracker.handle(&[log(10.0, LogEvent::RewardScreenOpened)]);
    assert!(opens(&step).is_empty());
    assert_eq!(decisions(&step), [Decision::Ignored(Ignored::ManualMode)]);
    let step = tracker.handle(&[log(10.5, LogEvent::RewardsRequested)]);
    assert_eq!(decisions(&step), [Decision::Ignored(Ignored::ManualMode)]);

    let step = tracker.handle(&[title(11.0, Some(Screen::RewardChoice))]);
    assert_eq!(opens(&step), [(1, Overlay::RelicReward)]);
    let step = tracker.handle(&[log(20.0, LogEvent::RewardScreenClosed)]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicReward,
            CloseReason::Left(LeaveReason::Closed)
        )]
    );
}

#[test]
fn background_title_ocr_closes_but_does_not_open_in_manual_mode() {
    let mut tracker = Tracker::new();
    tracker.set_manual(true);
    tracker.handle(&[title(1.0, Some(Screen::RewardChoice))]);

    let step = tracker.handle(&[observed_title(2.0, Some(Screen::RelicSelection))]);
    assert_eq!(
        closes(&step),
        [(
            1,
            Overlay::RelicReward,
            CloseReason::Left(LeaveReason::Replaced)
        )]
    );
    assert!(opens(&step).is_empty());
    assert_eq!(screen_now(&tracker), None);
}
