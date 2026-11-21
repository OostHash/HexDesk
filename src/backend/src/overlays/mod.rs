//! The overlay runtime: one thread owns the [`Tracker`] from the
//! `hexdesk-overlays` crate (`src/backend/crates/overlays`), takes every
//! signal (EE.log lines, the overlay key, timers, the overlay windows) over
//! one channel and carries out what the tracker decides.
//!
//! Each visit to a screen with an overlay is one operation in the log: the
//! signal that started it, what was read from the screen, what the overlay
//! was given, whether the window drew it, and the signal that ended it.
//!
//! The Relic Pick, Relic Reward and riven overlays run here.

mod pick;
pub(crate) mod reward;
mod riven;
pub(crate) mod window;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use hexdesk_overlays::ee_log::LogEvent;
use hexdesk_overlays::tracker::CloseReason;
use hexdesk_overlays::{
    Action, Decision, Flow, FlowTracker, HideBy, Millis, Overlay, Screen, Signal, SignalKind,
    Tracker, Visit, VisitId,
};
use tauri::{Emitter, Manager};
use tracing::Span;

use crate::app_state::AppState;
use crate::events;

/// How long an overlay window has to confirm that it drew what it was sent.
/// A window that was just shown again can take over a second to draw.
const RENDER_WAIT: Duration = Duration::from_secs(5);

/// Logs at info level under the source of `overlay`.
macro_rules! info_for {
    ($overlay:expr, $($rest:tt)*) => {
        match $overlay {
            Overlay::RelicPick => hexdesk_diag::info!(relic_pick, $($rest)*),
            Overlay::RelicReward => hexdesk_diag::info!(relic_reward, $($rest)*),
            Overlay::Riven => hexdesk_diag::info!(riven, $($rest)*),
        }
    };
}

/// Logs at debug level under the source of `overlay`.
macro_rules! debug_for {
    ($overlay:expr, $($rest:tt)*) => {
        match $overlay {
            Overlay::RelicPick => hexdesk_diag::debug!(relic_pick, $($rest)*),
            Overlay::RelicReward => hexdesk_diag::debug!(relic_reward, $($rest)*),
            Overlay::Riven => hexdesk_diag::debug!(riven, $($rest)*),
        }
    };
}

/// Something for the runtime thread.
pub(crate) enum Input {
    /// Signals in the order they happened, such as the events of one EE.log
    /// read.
    Signals(Vec<Signal>),
    /// An overlay was turned on or off in the settings.
    Switch(Overlay, bool),
    /// A screen title the overlay key read, with the operation of that key
    /// press: a visit the title starts runs inside it.
    Key { signal: Signal, op: Span },
    /// Manual mode was turned on or off in the settings.
    Manual(bool),
    /// The Relic Pick read for a visit finished; `None` when no era was read.
    PickReady {
        visit: VisitId,
        pick: Option<pick::PickView>,
    },
    /// The reward card read for a visit finished.
    RewardReady {
        visit: VisitId,
        result: reward::RewardResult,
    },
    /// The riven check for a visit finished.
    RivenReady {
        visit: VisitId,
        view: serde_json::Value,
    },
    /// The player asked for a riven check: "Check Riven" in the app or "New
    /// roll" in the overlay.
    RivenCheck,
    /// An overlay window drew a view.
    Rendered {
        overlay: Overlay,
        view: u64,
        summary: String,
    },
    /// Time is up for a window to confirm a view.
    RenderCheck { overlay: Overlay, view: u64 },
    /// Page Up (correct) or Page Down (wrong) while the test prompt is shown.
    TestingFeedback { correct: bool },
    /// An overlay close button also ignores a visible test prompt.
    DismissTestingFeedback,
    /// A full inventory update arrived after a run.
    InventoryUpdated(Millis),
    /// Remove logs also cleared all pending and reported test data.
    TestingDataRemoved,
    /// An unanswered prompt expires; the flow id prevents an old timer from
    /// dismissing a newer prompt.
    TestingPromptTimeout(u64),
}

static INPUT: OnceLock<Sender<Input>> = OnceLock::new();

/// The visit that is current, or 0; lets a background read stop early.
static CURRENT_VISIT: AtomicU64 = AtomicU64::new(0);

/// The Relic Reward overlay shows cards, for the overlay key.
static REWARD_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether the Relic Reward overlay shows cards.
pub(crate) fn reward_shown() -> bool {
    REWARD_SHOWN.load(Ordering::SeqCst)
}

/// Sends something to the runtime thread. Does nothing before [`start`].
pub(crate) fn send(input: Input) {
    if let Some(sender) = INPUT.get() {
        let _ = sender.send(input);
    }
}

/// Shows one short line in the app header and above the game window.
pub(crate) fn status(app: &tauri::AppHandle, text: &'static str) {
    let _ = app.emit(events::STATUS_LINE, text);
}

/// The current time on the clock signals use.
pub(crate) fn now() -> Millis {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as Millis)
        .unwrap_or(0)
}

/// Whether `visit` is still the current visit.
pub(crate) fn is_current(visit: VisitId) -> bool {
    CURRENT_VISIT.load(Ordering::SeqCst) == visit
}

/// Tells the runtime which overlays the settings turn on.
pub(crate) fn sync_switches(state: &AppState) {
    let overlays = state.overlays_enabled.load(Ordering::SeqCst);
    let pick = state.relic_pick_overlay_enabled.load(Ordering::SeqCst);
    send(Input::Switch(Overlay::RelicPick, overlays && pick));
    let reward = state.relic_reward_overlay_enabled.load(Ordering::SeqCst);
    send(Input::Switch(Overlay::RelicReward, overlays && reward));
    let riven = state.riven_overlay_enabled.load(Ordering::SeqCst);
    send(Input::Switch(Overlay::Riven, overlays && riven));
    send(Input::Manual(state.overlay_manual.load(Ordering::SeqCst)));
}

/// Starts the runtime thread. Called once at startup.
pub(crate) fn start(app: tauri::AppHandle) {
    let (sender, inputs) = mpsc::channel();
    if INPUT.set(sender).is_err() {
        return;
    }
    sync_switches(&app.state::<AppState>());
    crate::overlay_key::ensure_hook(app.clone());
    std::thread::spawn(move || {
        let mut runtime = Runtime::new(app);
        for input in inputs {
            runtime.handle(input);
        }
    });
}

/// An overlay view sent to its window.
struct Shown {
    visit: VisitId,
    view: u64,
    rendered: bool,
    /// When the view was sent to the window.
    sent: std::time::Instant,
}

struct Runtime {
    app: tauri::AppHandle,
    tracker: Tracker,
    flows: FlowTracker,
    testing: crate::testing::Runtime,
    /// The log operation of each visit that has not ended.
    ops: HashMap<VisitId, Span>,
    shown: HashMap<Overlay, Shown>,
    next_view: u64,
    /// The riven checks run in the current riven visit.
    riven_rolls: u32,
    /// The operation of the overlay key press being handled.
    key_op: Option<Span>,
}

impl Runtime {
    fn new(app: tauri::AppHandle) -> Runtime {
        let settings_path = app.state::<AppState>().settings_path.clone();
        Runtime {
            app,
            tracker: Tracker::new(),
            flows: FlowTracker::new(),
            testing: crate::testing::Runtime::new(settings_path),
            ops: HashMap::new(),
            shown: HashMap::new(),
            next_view: 1,
            riven_rolls: 0,
            key_op: None,
        }
    }

    fn handle(&mut self, input: Input) {
        match input {
            Input::Signals(signals) => {
                let step = self.tracker.handle(&signals);
                for (signal, decision) in &step.decisions {
                    self.log_decision(signal, decision);
                }
                if let Some(ended_at) = signals.iter().find_map(|signal| {
                    matches!(signal.kind, SignalKind::Log(LogEvent::MissionEnding))
                        .then_some(signal.at)
                }) {
                    if let Some(flow) = self.flows.end_run() {
                        self.log_completed_flow(flow);
                    }
                    self.testing.run_ended(&self.app, ended_at);
                }
                CURRENT_VISIT.store(self.tracker.current().map_or(0, |v| v.id), Ordering::SeqCst);
                for action in step.actions {
                    self.act(action);
                }
                self.drop_ended_ops();
            }
            Input::Key { signal, op } => {
                self.key_op = Some(op);
                self.handle(Input::Signals(vec![signal]));
                self.key_op = None;
            }
            Input::Manual(on) => {
                if self.tracker.manual() != on {
                    hexdesk_diag::info!(overlay, on, "Manual mode switched");
                }
                self.tracker.set_manual(on);
            }
            Input::Switch(overlay, on) => {
                if self.tracker.overlay_on(overlay) != on {
                    hexdesk_diag::info!(overlay, overlay = overlay.name(), on, "Overlay switched");
                }
                for action in self.tracker.set_overlay_on(overlay, on) {
                    self.act(action);
                }
            }
            Input::PickReady { visit, pick } => self.pick_ready(visit, pick),
            Input::RewardReady { visit, result } => self.reward_ready(visit, result),
            Input::RivenReady { visit, view } => self.riven_ready(visit, view),
            Input::RivenCheck => self.riven_check(),
            Input::Rendered {
                overlay,
                view,
                summary,
            } => self.rendered(overlay, view, &summary),
            Input::RenderCheck { overlay, view } => {
                if let Some(shown) = self.shown.get(&overlay) {
                    if shown.view == view && !shown.rendered {
                        let _span = self.op(shown.visit).entered();
                        let _ = hexdesk_diag::DiagError::new(
                            overlay_source(overlay),
                            hexdesk_diag::Kind::Timeout,
                            "Overlay shown but not drawn: its window did not confirm the view",
                        )
                        .with("overlay", overlay.name())
                        .with("view", view)
                        .with("waited_ms", RENDER_WAIT.as_millis())
                        .log();
                    }
                }
            }
            Input::TestingFeedback { correct } => self.testing.answer(&self.app, correct),
            Input::DismissTestingFeedback => self.testing.dismiss_prompt(&self.app),
            Input::InventoryUpdated(at) => self.testing.inventory_updated(&self.app, at),
            Input::TestingDataRemoved => self.testing.data_removed(&self.app),
            Input::TestingPromptTimeout(flow) => self.testing.prompt_timeout(&self.app, flow),
        }
    }

    /// The log operation of a visit; a detached span when it has none.
    fn op(&self, visit: VisitId) -> Span {
        self.ops.get(&visit).cloned().unwrap_or_else(Span::none)
    }

    fn begin_op(&mut self, visit: &Visit) -> Span {
        if let Some(op) = self.key_op.take() {
            self.ops.insert(visit.id, op.clone());
            return op;
        }
        let span = match visit.screen {
            Screen::RelicSelection => hexdesk_diag::op!(relic_pick, "Relic selection"),
            Screen::RelicRefinement => hexdesk_diag::op!(relic_pick, "Relic refinement"),
            Screen::RewardChoice => hexdesk_diag::op!(relic_reward, "Fissure rewards"),
            Screen::Riven => hexdesk_diag::op!(riven, "Riven screen"),
        };
        self.ops.insert(visit.id, span.clone());
        span
    }

    fn drop_ended_ops(&mut self) {
        let current = self.tracker.current().map(|v| v.id);
        self.ops.retain(|id, _| Some(*id) == current);
    }

    fn log_decision(&mut self, signal: &Signal, decision: &Decision) {
        let by = signal.source();
        let late_ms = now() - signal.at;
        match decision {
            Decision::Entered { visit, overlay_on } => {
                self.log_entered(visit, *overlay_on, &by, late_ms);
                for flow in self.flows.enter(visit.id, visit.screen) {
                    self.log_completed_flow(flow);
                }
                self.testing.visit_started(&self.app, visit.id);
            }
            Decision::Left {
                visit,
                reason,
                next,
                next_overlay_on,
            } => {
                let overlay = visit.screen.overlay();
                self.op(visit.id).in_scope(|| {
                    info_for!(
                        overlay,
                        visit = visit.id,
                        screen = visit.screen.name(),
                        reason = reason.name(),
                        by = %by,
                        late_ms,
                        "Screen left"
                    )
                });
                if let Some(flow) = self.flows.leave(visit.id, visit.screen) {
                    self.log_completed_flow(flow);
                }
                if let Some(next) = next {
                    self.log_entered(next, *next_overlay_on, &by, late_ms);
                    for flow in self.flows.enter(next.id, next.screen) {
                        self.log_completed_flow(flow);
                    }
                    self.testing.visit_started(&self.app, next.id);
                }
            }
            Decision::Hidden { visit } | Decision::ShownAgain { visit } => {
                let overlay = self
                    .tracker
                    .current()
                    .map_or(Overlay::RelicPick, |v| v.screen.overlay());
                let message = if matches!(decision, Decision::Hidden { .. }) {
                    "Overlay hidden by the player; the screen is still up"
                } else {
                    "Overlay shown again by the overlay key"
                };
                self.op(*visit)
                    .in_scope(|| info_for!(overlay, visit = *visit, "{message}"));
            }
            Decision::Ignored(why) => {
                let overlay = match signal.kind {
                    SignalKind::Title(Some(screen)) => Some(screen.overlay()),
                    _ => self.tracker.current().map(|v| v.screen.overlay()),
                };
                let reason = why.describe();
                match overlay {
                    Some(overlay) => {
                        debug_for!(overlay, by = %by, reason = %reason, late_ms, "Signal ignored")
                    }
                    None => {
                        hexdesk_diag::debug!(overlay, by = %by, reason = %reason, late_ms, "Signal ignored")
                    }
                }
            }
        }
    }

    fn log_completed_flow(&mut self, flow: Flow) {
        hexdesk_diag::debug!(
            overlay,
            flow = flow.id,
            kind = flow.kind.name(),
            visits = ?flow.visits,
            "Testing flow completed"
        );
        self.testing.flow_completed(&self.app, flow);
    }

    fn log_entered(&mut self, visit: &Visit, overlay_on: bool, by: &str, late_ms: Millis) {
        let overlay = visit.screen.overlay();
        self.begin_op(visit).in_scope(|| {
            info_for!(
                overlay,
                visit = visit.id,
                screen = visit.screen.name(),
                by = %by,
                late_ms,
                overlay_on,
                "Screen entered"
            )
        });
        if !overlay_on {
            let text = match overlay {
                Overlay::RelicPick => "Relic Pick overlay is turned off",
                Overlay::RelicReward => "Relic Reward overlay is turned off",
                Overlay::Riven => "Riven overlay is turned off",
            };
            status(&self.app, text);
        }
    }

    fn act(&mut self, action: Action) {
        match action {
            Action::Open {
                visit,
                overlay: Overlay::RelicPick,
            } => {
                // A screen seen in EE.log may still be drawing; a title read
                // by the overlay key means it is on screen already.
                let wait_for_render = matches!(visit.entered_by, SignalKind::Log(_));
                pick::read(
                    self.app.clone(),
                    visit.id,
                    wait_for_render,
                    self.op(visit.id),
                );
            }
            Action::Close {
                visit,
                overlay: Overlay::RelicPick,
                reason,
            } => self.close_pick(visit, reason),
            Action::Open {
                visit,
                overlay: Overlay::RelicReward,
            } => {
                // The main window places the overlay strip over the game
                // while the cards are read.
                status(&self.app, "Reading relic rewards…");
                let _ = self.app.emit(events::RELIC_TRIGGER, ());
                let by_key = matches!(visit.entered_by, SignalKind::Title(_));
                reward::read(self.app.clone(), visit.id, by_key, self.op(visit.id));
            }
            Action::Close {
                visit,
                overlay: Overlay::RelicReward,
                reason,
            } => {
                let _guard = self.op(visit).entered();
                REWARD_SHOWN.store(false, Ordering::SeqCst);
                reward::hide(&self.app);
                hexdesk_diag::info!(
                    relic_reward,
                    visit,
                    reason = close_reason(reason),
                    "Relic Reward overlay hidden"
                );
                status(&self.app, "Relic Reward overlay hidden");
            }
            Action::Timer { visit, at } => {
                std::thread::spawn(move || {
                    let wait = (at - now()).max(0) as u64;
                    std::thread::sleep(Duration::from_millis(wait));
                    send(Input::Signals(vec![Signal::timeout(at, visit)]));
                });
            }
            Action::Open {
                visit,
                overlay: Overlay::Riven,
            } => {
                self.riven_rolls = 0;
                self.check_riven(visit.id);
            }
            Action::Close {
                visit,
                overlay: Overlay::Riven,
                reason,
            } => self.close_riven(visit, reason),
        }
    }

    fn pick_ready(&mut self, visit: VisitId, pick: Option<pick::PickView>) {
        if let Some(screen) = pick.as_ref().and_then(|pick| pick.screen) {
            self.flows.reclassify(visit, screen);
            hexdesk_diag::debug!(
                overlay,
                visit,
                screen = screen.name(),
                "Relic-list flow classified from OCR title"
            );
        }
        let span = self.op(visit);
        let _guard = span.enter();
        let current = self.tracker.current().copied();
        let showing = current.is_some_and(|v| v.id == visit && v.hidden_at.is_none())
            && self.tracker.overlay_on(Overlay::RelicPick);
        if !showing {
            hexdesk_diag::info!(
                relic_pick,
                visit,
                "Relic Pick result dropped: the visit ended or its overlay was hidden"
            );
            return;
        }
        let Some(pick) = pick else {
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::RelicPick,
                hexdesk_diag::Kind::NotFound,
                "Relic Pick overlay not shown: no fissure era read from the screen",
            )
            .with("visit", visit)
            .log();
            status(&self.app, "Could not read the relic list");
            return;
        };
        if let Err(reason) = window::show_relic_pick(&self.app) {
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::RelicPick,
                hexdesk_diag::Kind::Internal,
                "Relic Pick overlay could not be shown",
            )
            .with("visit", visit)
            .with("reason", reason)
            .log();
            status(&self.app, "Could not show the Relic Pick overlay");
            return;
        }
        let pick::PickView {
            era,
            screen: _,
            relics,
            mut payload,
        } = pick;
        let view = self.track_view(Overlay::RelicPick, visit);
        payload["view"] = serde_json::json!(view);
        let _ = self.app.emit(events::RELIC_PICK_OPEN, payload);
        hexdesk_diag::info!(
            relic_pick,
            visit,
            view,
            era,
            relics,
            "Relic Pick overlay ready"
        );
        status(&self.app, "Relic Pick overlay ready");
    }

    /// Numbers a view sent to an overlay window and checks that the window
    /// confirms it within [`RENDER_WAIT`].
    fn track_view(&mut self, overlay: Overlay, visit: VisitId) -> u64 {
        let view = self.next_view;
        self.next_view += 1;
        self.shown.insert(
            overlay,
            Shown {
                visit,
                view,
                rendered: false,
                sent: std::time::Instant::now(),
            },
        );
        std::thread::spawn(move || {
            std::thread::sleep(RENDER_WAIT);
            send(Input::RenderCheck { overlay, view });
        });
        view
    }

    /// Whether the riven overlay of `visit` is on screen.
    fn riven_showing(&self, visit: VisitId) -> bool {
        self.tracker
            .current()
            .is_some_and(|v| v.id == visit && v.hidden_at.is_none())
            && self.tracker.overlay_on(Overlay::Riven)
    }

    /// Shows the riven window with "scanning" and starts the next check.
    fn check_riven(&mut self, visit: VisitId) {
        let span = self.op(visit);
        let _guard = span.enter();
        if let Err(reason) = window::show_riven(&self.app) {
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::Riven,
                hexdesk_diag::Kind::Internal,
                "Riven overlay could not be shown",
            )
            .with("visit", visit)
            .with("reason", reason)
            .log();
            return;
        }
        self.riven_rolls += 1;
        let roll = self.riven_rolls;
        self.send_riven_view(visit, riven::scanning(roll));
        hexdesk_diag::info!(riven, visit, roll, "Riven check started");
        status(&self.app, "Reading riven…");
        riven::check(visit, roll, span.clone());
    }

    fn send_riven_view(&mut self, visit: VisitId, mut view: serde_json::Value) {
        view["view"] = serde_json::json!(self.track_view(Overlay::Riven, visit));
        let _ = self.app.emit(events::RIVEN_VIEW, view);
    }

    fn riven_ready(&mut self, visit: VisitId, view: serde_json::Value) {
        let _guard = self.op(visit).entered();
        if !self.riven_showing(visit) {
            hexdesk_diag::info!(
                riven,
                visit,
                "Riven check dropped: the visit ended or its overlay was hidden"
            );
            return;
        }
        let read = riven::describe(&view);
        self.send_riven_view(visit, view);
        hexdesk_diag::info!(riven, visit, read = %read, "Riven overlay shown");
        status(&self.app, "Riven overlay shown");
    }

    /// A check the player asked for: a new roll on the riven screen that is
    /// up, or the riven screen entered as if the overlay key read its title.
    fn riven_check(&mut self) {
        match self.tracker.current().copied() {
            Some(visit) if visit.screen == Screen::Riven && self.riven_showing(visit.id) => {
                self.check_riven(visit.id);
            }
            _ if !self.tracker.overlay_on(Overlay::Riven) => {
                hexdesk_diag::info!(
                    riven,
                    "Riven check not run: the riven overlay is turned off"
                );
            }
            _ => self.handle(Input::Signals(vec![Signal::title(
                now(),
                Some(Screen::Riven),
            )])),
        }
    }

    fn close_riven(&mut self, visit: VisitId, reason: CloseReason) {
        let _guard = self.op(visit).entered();
        let reason = close_reason(reason);
        self.shown.remove(&Overlay::Riven);
        let _ = self.app.emit(events::RIVEN_VIEW, serde_json::Value::Null);
        match window::hide(&self.app, window::RIVEN) {
            Ok(()) => {
                hexdesk_diag::info!(riven, visit, reason, "Riven overlay hidden");
                status(&self.app, "Riven overlay hidden");
            }
            Err(why) => {
                let _ = hexdesk_diag::DiagError::new(
                    hexdesk_diag::Source::Riven,
                    hexdesk_diag::Kind::Internal,
                    "Riven overlay could not be hidden",
                )
                .with("visit", visit)
                .with("reason", why)
                .log();
            }
        }
    }

    fn reward_ready(&mut self, visit: VisitId, result: reward::RewardResult) {
        let _guard = self.op(visit).entered();
        let showing = self
            .tracker
            .current()
            .is_some_and(|v| v.id == visit && v.hidden_at.is_none());
        if !showing {
            hexdesk_diag::info!(
                relic_reward,
                visit,
                "Reward cards dropped: the visit ended or its overlay was hidden"
            );
            return;
        }
        let Some(payload) = result.payload else {
            hexdesk_diag::info!(
                relic_reward,
                visit,
                attempts = result.attempts,
                reason = result.reason,
                "Relic Reward overlay not shown: no card was read"
            );
            status(&self.app, "Could not read the reward cards");
            return;
        };
        hexdesk_diag::info!(
            relic_reward,
            visit,
            attempts = result.attempts,
            cards = result.cards,
            reason = result.reason,
            "Relic Reward overlay shown"
        );
        REWARD_SHOWN.store(true, Ordering::SeqCst);
        reward::publish_relic_rewards(&self.app, Some(&payload));
        reward::watch_title(visit, self.op(visit));
        status(&self.app, "Relic Reward overlay shown");
    }

    fn close_pick(&mut self, visit: VisitId, reason: CloseReason) {
        let _guard = self.op(visit).entered();
        let reason = close_reason(reason);
        self.shown.remove(&Overlay::RelicPick);
        let _ = self.app.emit(events::RELIC_PICK_CLOSE, ());
        match window::park_relic_pick(&self.app) {
            Ok(()) => {
                hexdesk_diag::info!(relic_pick, visit, reason, "Relic Pick overlay hidden");
                status(&self.app, "Relic Pick overlay hidden");
            }
            Err(why) => {
                let _ = hexdesk_diag::DiagError::new(
                    hexdesk_diag::Source::RelicPick,
                    hexdesk_diag::Kind::Internal,
                    "Relic Pick overlay could not be hidden",
                )
                .with("visit", visit)
                .with("reason", why)
                .log();
            }
        }
    }

    fn rendered(&mut self, overlay: Overlay, view: u64, summary: &str) {
        let visit = match self.shown.get_mut(&overlay) {
            Some(shown) if shown.view == view => {
                shown.rendered = true;
                let visit = shown.visit;
                let draw_ms = shown.sent.elapsed().as_millis() as u64;
                let place = window::describe(&self.app, window_label(overlay));
                self.op(visit).in_scope(
                    || info_for!(overlay, visit, view, draw_ms, window = %place, shown = %summary, "Overlay drawn"),
                );
                if overlay == Overlay::RelicPick {
                    status(&self.app, "Relic Pick overlay shown");
                }
                visit
            }
            Some(shown) => {
                debug_for!(
                    overlay,
                    view,
                    current_view = shown.view,
                    "Overlay drew an older view"
                );
                return;
            }
            None if overlay == Overlay::RelicPick => {
                debug_for!(overlay, view, "Overlay drew a view that is no longer shown");
                return;
            }
            // Overlays this runtime does not show yet report what they drew
            // too; their lines join the visit of their screen.
            None => {
                let visit = self
                    .tracker
                    .current()
                    .filter(|v| v.screen.overlay() == overlay)
                    .map_or(0, |v| v.id);
                let place = window::describe(&self.app, window_label(overlay));
                self.op(visit).in_scope(
                    || info_for!(overlay, visit, view, window = %place, shown = %summary, "Overlay drawn"),
                );
                visit
            }
        };
        if crate::captures::screenshots() || crate::testing::capturing(visit) {
            screenshot(overlay, visit, self.op(visit));
        }
    }
}

/// A screenshot taken this long after the overlay was drawn may show a later
/// screen, so it is not kept.
const SCREENSHOT_LATE: Duration = Duration::from_millis(1500);

/// Saves the game's monitor, game and overlay together, in the background.
fn screenshot(overlay: Overlay, visit: VisitId, op: Span) {
    let drawn = std::time::Instant::now();
    std::thread::spawn(move || {
        let _guard = op.enter();
        let shot = hexdesk_capture::capture_screen();
        let after_ms = drawn.elapsed().as_millis() as u64;
        if drawn.elapsed() > SCREENSHOT_LATE {
            info_for!(
                overlay,
                after_ms,
                "Screenshot not saved: taken too long after the overlay was drawn"
            );
            return;
        }
        match shot {
            Ok(frame) => {
                let prefix = format!("screenshot-{}", overlay.name().replace('_', "-"));
                let bmp = frame.to_bmp();
                crate::testing::save_overlay(visit, &prefix, &bmp);
                if crate::captures::screenshots() {
                    if let Some(capture) = crate::captures::save(&prefix, &bmp) {
                        info_for!(overlay, after_ms, capture = %capture, "Screenshot saved");
                    }
                }
            }
            Err(reason) => info_for!(overlay, reason = %reason, "Screenshot not saved"),
        }
    });
}

/// The window an overlay draws in.
fn window_label(overlay: Overlay) -> &'static str {
    match overlay {
        Overlay::RelicPick => window::RELIC_PICK,
        Overlay::RelicReward => "relic-overlay",
        Overlay::Riven => window::RIVEN,
    }
}

fn close_reason(reason: CloseReason) -> &'static str {
    match reason {
        CloseReason::Left(left) => left.name(),
        CloseReason::Player => "hidden by the player",
        CloseReason::TurnedOff => "turned off",
    }
}

fn overlay_source(overlay: Overlay) -> hexdesk_diag::Source {
    match overlay {
        Overlay::RelicPick => hexdesk_diag::Source::RelicPick,
        Overlay::RelicReward => hexdesk_diag::Source::RelicReward,
        Overlay::Riven => hexdesk_diag::Source::Riven,
    }
}

/// Reports that the player closed an overlay with its close button.
#[tauri::command]
pub(crate) fn overlay_closed() {
    send(Input::DismissTestingFeedback);
    send(Input::Signals(vec![Signal::hide(
        now(),
        HideBy::CloseButton,
    )]));
}

/// Reports the full account update that follows a completed run.
pub(crate) fn inventory_updated() {
    send(Input::InventoryUpdated(now()));
}

/// Synchronizes the runtime after Remove logs deleted its testing folders.
pub(crate) fn testing_data_removed() {
    send(Input::TestingDataRemoved);
}

/// Runs a riven check: "Check Riven" in the app and "New roll" in the
/// overlay.
#[tauri::command]
pub(crate) fn check_riven() {
    send(Input::RivenCheck);
}

/// Places and shows the riven window for the Settings preview.
#[tauri::command]
pub(crate) fn show_riven_window(app: tauri::AppHandle) -> Result<(), String> {
    window::show_riven(&app)
}

/// Reports that an overlay window drew a view: its overlay name
/// ("relic_pick"), the view number it was sent and a one-line summary of
/// what it shows.
#[tauri::command]
pub(crate) fn overlay_rendered(overlay: String, view: u64, summary: String) {
    let overlay = match overlay.as_str() {
        "relic_pick" => Overlay::RelicPick,
        "relic_reward" => Overlay::RelicReward,
        "riven" => Overlay::Riven,
        _ => return,
    };
    send(Input::Rendered {
        overlay,
        view,
        summary,
    });
}
