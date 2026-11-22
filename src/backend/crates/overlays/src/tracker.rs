//! The tracker: which screen with an overlay is up, decided from signals.
//!
//! Each time a screen with an overlay comes up, the tracker starts a
//! [`Visit`]. A visit ends when a signal says the screen closed, when another
//! screen comes up, or when its time limit runs out. The overlay key can hide
//! a visit's overlay while the screen stays up, and show it again.
//!
//! Signals can arrive late and out of order: EE.log lines reach us in bursts,
//! seconds after the game wrote them, while a title read by the overlay key
//! is current. A signal older than what the current state is based on cannot
//! change it.

use crate::ee_log::LogEvent;
use crate::screen::{Overlay, Screen};
use crate::signal::{Millis, Signal, SignalKind};

/// Identifies a visit; counts up from 1.
pub type VisitId = u64;

/// Two opens of the same screen this close together are one visit. The game
/// writes the relic list line twice within a millisecond.
const SAME_VISIT_MS: Millis = 3_000;

/// A riven screen close line this soon after the open belongs to the screen
/// the player came from.
const RIVEN_CLOSE_MIN_MS: Millis = 1_000;

/// One stay on a screen with an overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Visit {
    pub id: VisitId,
    pub screen: Screen,
    /// When the signal that started the visit happened.
    pub entered_at: Millis,
    /// The signal that started the visit.
    pub entered_by: SignalKind,
    /// The newest signal that showed the screen is up. Hiding the overlay
    /// says nothing about the screen, so it does not count.
    pub confirmed_at: Millis,
    /// When the player hid the overlay while the screen stayed up; `None`
    /// while it is shown.
    pub hidden_at: Option<Millis>,
}

/// Why a visit ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaveReason {
    /// A signal said the screen closed.
    Closed,
    /// Another screen with an overlay came up.
    Replaced,
    /// A newer open of the same screen started a new visit.
    Reopened,
    /// Nothing reported a close within the screen's time limit.
    TimeLimit,
}

impl LeaveReason {
    pub const fn name(self) -> &'static str {
        match self {
            LeaveReason::Closed => "closed",
            LeaveReason::Replaced => "another screen came up",
            LeaveReason::Reopened => "the screen opened again",
            LeaveReason::TimeLimit => "time limit",
        }
    }
}

/// Why a signal changed nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ignored {
    /// The signal is older than what the current state is based on.
    OlderThanState { state_at: Millis },
    /// The screen it opens was left after the signal happened.
    ScreenLeftSince { left_at: Millis },
    /// The signal belongs to the screen that is already up.
    SameVisit,
    /// The signal closes a screen that is not up.
    NotOnThatScreen,
    /// The overlay key read a title that matched no screen with an overlay.
    TitleNotRecognised,
    /// The player asked to hide, but no overlay is on screen.
    NothingToHide,
    /// The time limit belongs to a visit that already ended.
    VisitAlreadyOver,
    /// A riven close line too soon after the riven screen opened.
    TooSoonAfterOpen,
    /// Manual mode: only the overlay key opens a screen.
    ManualMode,
}

impl Ignored {
    pub fn describe(self) -> String {
        match self {
            Ignored::OlderThanState { state_at } => {
                format!("older than the current state (from {state_at})")
            }
            Ignored::ScreenLeftSince { left_at } => {
                format!("that screen was left after it (at {left_at})")
            }
            Ignored::SameVisit => "belongs to the screen already up".to_string(),
            Ignored::NotOnThatScreen => "that screen is not up".to_string(),
            Ignored::TitleNotRecognised => "title matched no screen with an overlay".to_string(),
            Ignored::NothingToHide => "no overlay on screen".to_string(),
            Ignored::VisitAlreadyOver => "that visit already ended".to_string(),
            Ignored::TooSoonAfterOpen => "too soon after the screen opened".to_string(),
            Ignored::ManualMode => "manual mode: only the overlay key opens a screen".to_string(),
        }
    }
}

/// What one signal did, for the log. Every signal yields exactly one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// A visit started. `overlay_on` is false when that overlay is turned off.
    Entered { visit: Visit, overlay_on: bool },
    /// The current visit ended, and possibly a new one started.
    Left {
        visit: Visit,
        reason: LeaveReason,
        next: Option<Visit>,
        next_overlay_on: bool,
    },
    /// The player hid the overlay; the screen is still up.
    Hidden { visit: VisitId },
    /// The overlay key showed a hidden overlay again.
    ShownAgain { visit: VisitId },
    /// The signal changed nothing.
    Ignored(Ignored),
}

/// What the app has to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Read the screen and show the overlay for this visit.
    Open { visit: Visit, overlay: Overlay },
    /// Hide the overlay; the visit is over or was hidden by the user.
    Close {
        visit: VisitId,
        overlay: Overlay,
        reason: CloseReason,
    },
    /// Send [`SignalKind::Timeout`] for this visit at `at`.
    Timer { visit: VisitId, at: Millis },
}

/// Why an overlay is hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    Left(LeaveReason),
    /// The player hid it.
    Player,
    /// The overlay was turned off.
    TurnedOff,
}

/// The result of handling signals.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Step {
    /// One decision per signal, in order.
    pub decisions: Vec<(Signal, Decision)>,
    pub actions: Vec<Action>,
}

/// Which screen with an overlay is up.
#[derive(Debug, Clone)]
pub struct Tracker {
    current: Option<Visit>,
    /// The screen of the last visit that ended, and when it ended.
    last_left: Option<(Screen, Millis)>,
    next_id: VisitId,
    overlay_on: [bool; 3],
    manual: bool,
}

impl Default for Tracker {
    fn default() -> Self {
        Self::new()
    }
}

impl Tracker {
    /// A tracker with no screen up and every overlay turned on.
    pub fn new() -> Tracker {
        Tracker {
            current: None,
            last_left: None,
            next_id: 1,
            overlay_on: [true; 3],
            manual: false,
        }
    }

    /// The current visit, if a screen with an overlay is up.
    pub fn current(&self) -> Option<&Visit> {
        self.current.as_ref()
    }

    /// Whether an overlay is turned on in the settings.
    pub fn overlay_on(&self, overlay: Overlay) -> bool {
        self.overlay_on[overlay.index()]
    }

    /// Manual mode: EE.log lines no longer open a screen, only the overlay
    /// key does. They still close one.
    pub fn set_manual(&mut self, manual: bool) {
        self.manual = manual;
    }

    pub fn manual(&self) -> bool {
        self.manual
    }

    /// Turns an overlay on or off. Turning off the overlay of the current
    /// visit hides it; turning it on does not show it until the next visit.
    pub fn set_overlay_on(&mut self, overlay: Overlay, on: bool) -> Vec<Action> {
        self.overlay_on[overlay.index()] = on;
        match self.current {
            Some(visit)
                if !on && visit.hidden_at.is_none() && visit.screen.overlay() == overlay =>
            {
                vec![Action::Close {
                    visit: visit.id,
                    overlay,
                    reason: CloseReason::TurnedOff,
                }]
            }
            _ => Vec::new(),
        }
    }

    /// Handles signals in the order given, which for EE.log is the order of
    /// the log. A visit that starts and ends within one call never reaches
    /// the app: the game wrote both lines before we read either, so that
    /// screen is gone.
    pub fn handle(&mut self, signals: &[Signal]) -> Step {
        let mut step = Step::default();
        for signal in signals {
            let decision = self.decide(*signal, &mut step.actions);
            step.decisions.push((*signal, decision));
        }
        let ended: Vec<VisitId> = step
            .decisions
            .iter()
            .filter_map(|(_, d)| match d {
                Decision::Left { visit, .. } => Some(visit.id),
                _ => None,
            })
            .collect();
        drop_visits_already_over(&mut step.actions, &ended);
        step
    }

    fn decide(&mut self, signal: Signal, actions: &mut Vec<Action>) -> Decision {
        match signal.kind {
            SignalKind::Log(event) => match log_effect(event) {
                Effect::Enter(_) if self.manual => Decision::Ignored(Ignored::ManualMode),
                Effect::Enter(screen) => self.enter(screen, signal, actions),
                Effect::Confirm(screen) => match self.current {
                    Some(visit) if visit.screen == screen => self.confirm(screen, signal, actions),
                    _ if self.manual => Decision::Ignored(Ignored::ManualMode),
                    _ => self.enter(screen, signal, actions),
                },
                Effect::Leave(screens) => self.leave_if(screens, signal, actions),
            },
            SignalKind::Title(Some(screen)) => self.enter(screen, signal, actions),
            SignalKind::Title(None) => Decision::Ignored(Ignored::TitleNotRecognised),
            SignalKind::ObservedTitle(Some(screen)) => {
                if self.manual {
                    match self.current {
                        Some(visit) if visit.screen == screen => {
                            self.confirm(screen, signal, actions)
                        }
                        Some(_) => self.end(LeaveReason::Replaced, signal.at, None, actions),
                        None => Decision::Ignored(Ignored::ManualMode),
                    }
                } else {
                    self.enter(screen, signal, actions)
                }
            }
            SignalKind::ObservedTitle(None) => {
                self.leave_if(&[Screen::RewardChoice], signal, actions)
            }
            SignalKind::Hide(_) => self.hide(signal, actions),
            SignalKind::Timeout(id) => match self.current {
                Some(visit) if visit.id == id => {
                    self.end(LeaveReason::TimeLimit, signal.at, None, actions)
                }
                _ => Decision::Ignored(Ignored::VisitAlreadyOver),
            },
        }
    }

    fn enter(&mut self, screen: Screen, signal: Signal, actions: &mut Vec<Action>) -> Decision {
        if let Some(visit) = self.current {
            if signal.at < visit.confirmed_at && visit.screen != screen {
                return Decision::Ignored(Ignored::OlderThanState {
                    state_at: visit.confirmed_at,
                });
            }
            if visit.screen == screen {
                // An open written before the player hid the overlay belongs
                // to the visit they hid.
                let same = signal.at < visit.entered_at + SAME_VISIT_MS
                    || signal.at <= visit.confirmed_at
                    || visit.hidden_at.is_some_and(|hidden| signal.at <= hidden)
                    || matches!(
                        signal.kind,
                        SignalKind::Title(_) | SignalKind::ObservedTitle(_)
                    );
                if same {
                    return self.confirm(screen, signal, actions);
                }
                // A new open of the same screen after its close was missed,
                // as in an endless fissure where every round shows the
                // relic list again.
                return self.end(
                    LeaveReason::Reopened,
                    signal.at,
                    Some((screen, signal)),
                    actions,
                );
            }
            return self.end(
                LeaveReason::Replaced,
                signal.at,
                Some((screen, signal)),
                actions,
            );
        }
        if let Some((left, left_at)) = self.last_left {
            if left == screen && signal.at < left_at {
                return Decision::Ignored(Ignored::ScreenLeftSince { left_at });
            }
        }
        let visit = self.start(screen, signal, actions);
        Decision::Entered {
            visit,
            overlay_on: self.overlay_on(screen.overlay()),
        }
    }

    /// A signal for the screen that is already up. A title read by the
    /// overlay key shows a hidden overlay again.
    fn confirm(&mut self, screen: Screen, signal: Signal, actions: &mut Vec<Action>) -> Decision {
        let Some(visit) = self.current.as_mut() else {
            return Decision::Ignored(Ignored::NotOnThatScreen);
        };
        visit.confirmed_at = visit.confirmed_at.max(signal.at);
        let by_key = matches!(signal.kind, SignalKind::Title(_));
        if by_key && visit.hidden_at.is_some() {
            visit.hidden_at = None;
            let visit = *visit;
            if self.overlay_on(screen.overlay()) {
                actions.push(Action::Open {
                    visit,
                    overlay: screen.overlay(),
                });
            }
            return Decision::ShownAgain { visit: visit.id };
        }
        Decision::Ignored(Ignored::SameVisit)
    }

    fn leave_if(
        &mut self,
        screens: &[Screen],
        signal: Signal,
        actions: &mut Vec<Action>,
    ) -> Decision {
        let Some(visit) = self.current else {
            return Decision::Ignored(Ignored::NotOnThatScreen);
        };
        if !screens.contains(&visit.screen) {
            return Decision::Ignored(Ignored::NotOnThatScreen);
        }
        if signal.at < visit.confirmed_at {
            return Decision::Ignored(Ignored::OlderThanState {
                state_at: visit.confirmed_at,
            });
        }
        let riven_close = matches!(
            signal.kind,
            SignalKind::Log(LogEvent::RivenCardsHidden | LogEvent::OrbiterLoaded)
        );
        if riven_close && signal.at < visit.entered_at + RIVEN_CLOSE_MIN_MS {
            return Decision::Ignored(Ignored::TooSoonAfterOpen);
        }
        self.end(LeaveReason::Closed, signal.at, None, actions)
    }

    fn hide(&mut self, signal: Signal, actions: &mut Vec<Action>) -> Decision {
        let overlay_on = self.overlay_on;
        match self.current.as_mut() {
            Some(visit)
                if visit.hidden_at.is_none() && overlay_on[visit.screen.overlay().index()] =>
            {
                visit.hidden_at = Some(signal.at);
                actions.push(Action::Close {
                    visit: visit.id,
                    overlay: visit.screen.overlay(),
                    reason: CloseReason::Player,
                });
                Decision::Hidden { visit: visit.id }
            }
            _ => Decision::Ignored(Ignored::NothingToHide),
        }
    }

    /// Ends the current visit and, with `next`, starts a new one.
    fn end(
        &mut self,
        reason: LeaveReason,
        at: Millis,
        next: Option<(Screen, Signal)>,
        actions: &mut Vec<Action>,
    ) -> Decision {
        let Some(visit) = self.current.take() else {
            return Decision::Ignored(Ignored::NotOnThatScreen);
        };
        self.last_left = Some((visit.screen, at));
        if visit.hidden_at.is_none() && self.overlay_on(visit.screen.overlay()) {
            actions.push(Action::Close {
                visit: visit.id,
                overlay: visit.screen.overlay(),
                reason: CloseReason::Left(reason),
            });
        }
        let next = next.map(|(screen, signal)| self.start(screen, signal, actions));
        Decision::Left {
            visit,
            reason,
            next_overlay_on: next.is_some_and(|v| self.overlay_on(v.screen.overlay())),
            next,
        }
    }

    fn start(&mut self, screen: Screen, signal: Signal, actions: &mut Vec<Action>) -> Visit {
        let visit = Visit {
            id: self.next_id,
            screen,
            entered_at: signal.at,
            entered_by: signal.kind,
            confirmed_at: signal.at,
            hidden_at: None,
        };
        self.next_id += 1;
        self.current = Some(visit);
        if self.overlay_on(screen.overlay()) {
            actions.push(Action::Open {
                visit,
                overlay: screen.overlay(),
            });
        }
        actions.push(Action::Timer {
            visit: visit.id,
            at: signal.at + screen.time_limit_ms(),
        });
        visit
    }
}

enum Effect {
    /// The screen opened.
    Enter(Screen),
    /// The screen is up; it opens only if it was not up yet.
    Confirm(Screen),
    Leave(&'static [Screen]),
}

fn log_effect(event: LogEvent) -> Effect {
    use Screen::*;
    match event {
        LogEvent::RelicListOpened => Effect::Enter(RelicSelection),
        LogEvent::RelicVotesDone | LogEvent::SelectionCountdown | LogEvent::StarChartInput => {
            Effect::Leave(&[RelicSelection])
        }
        LogEvent::LevelLoading | LogEvent::MissionEnding => {
            Effect::Leave(&[RelicSelection, RelicRefinement, RewardChoice, Riven])
        }
        LogEvent::RewardScreenOpened => Effect::Enter(RewardChoice),
        LogEvent::RewardsRequested => Effect::Confirm(RewardChoice),
        LogEvent::RewardScreenClosed => Effect::Leave(&[RewardChoice]),
        LogEvent::RivenScreenOpened => Effect::Enter(Riven),
        LogEvent::RivenCardsHidden | LogEvent::OrbiterLoaded => Effect::Leave(&[Riven]),
    }
}

/// Removes the actions of visits that started and ended in the same step.
fn drop_visits_already_over(actions: &mut Vec<Action>, ended: &[VisitId]) {
    let id_of = |a: &Action| match a {
        Action::Open { visit, .. } => visit.id,
        Action::Close { visit, .. } | Action::Timer { visit, .. } => *visit,
    };
    let started_here: Vec<VisitId> = actions
        .iter()
        .filter_map(|a| match a {
            Action::Timer { visit, .. } => Some(*visit),
            _ => None,
        })
        .collect();
    let over: Vec<VisitId> = ended
        .iter()
        .copied()
        .filter(|id| started_here.contains(id))
        .collect();
    actions.retain(|a| !over.contains(&id_of(a)));
}
