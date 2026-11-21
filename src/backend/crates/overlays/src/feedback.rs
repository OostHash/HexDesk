//! Opt-in testing feedback: when to ask about a completed screen flow, what
//! happens to its samples, and when a run's report is ready.
//!
//! [`Feedback`] does no I/O of its own. Samples go through a [`SampleStore`],
//! and everything the app shows or logs comes back as [`Notice`]s, so the
//! rules can be tested without the game, the disk or a window.

use std::path::PathBuf;

use crate::flow::{Flow, FlowId, FlowKind, FlowTracker};
use crate::screen::Screen;
use crate::signal::Millis;
use crate::tracker::VisitId;

/// Identifies one run's report.
pub type RunId = u64;

/// Where the samples of tracker visits are kept until they are discarded or
/// reported.
pub trait SampleStore {
    /// Starts saving samples for `visit`.
    fn begin(&mut self, visit: VisitId);
    /// Stops saving samples for the visits of `flow`; what was saved stays.
    fn stop(&mut self, flow: &Flow);
    /// Whether anything was saved for the visits of `flow`.
    fn has_samples(&self, flow: &Flow) -> bool;
    /// Removes the samples of `flow`.
    fn discard(&mut self, flow: &Flow);
    /// Moves the samples of `flow` into the report of `run`.
    fn keep(&mut self, run: RunId, flow: &Flow) -> Result<(), String>;
    /// Writes the report of `run` and returns where it was written.
    fn export(&mut self, run: RunId) -> Result<PathBuf, String>;
    /// Removes every pending sample and every unexported report.
    fn remove_all(&mut self) -> Result<(), String>;
}

/// How often a completed flow leads to a prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prompting {
    /// After every n-th completed flow that has samples.
    EveryNFlows(u64),
    /// At most once per run.
    OncePerRun,
}

/// The player's testing choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    pub enabled: bool,
    pub prompting: Prompting,
}

impl Config {
    pub const OFF: Config = Config {
        enabled: false,
        prompting: Prompting::EveryNFlows(1),
    };
}

/// Why a flow's samples were dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscardReason {
    /// The player pressed Page Up.
    Correct,
    /// The prompt timed out, was closed, or a newer prompt replaced it.
    Ignored,
}

/// Something the app shows or logs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    /// A flow ended. Not every completed flow is asked about.
    FlowCompleted(Flow),
    /// Ask about `flow` now; the answer arrives through [`Feedback::answer`].
    PromptShown {
        flow: FlowId,
        kind: FlowKind,
    },
    /// No prompt is visible any more.
    PromptHidden,
    Discarded {
        flow: FlowId,
        reason: DiscardReason,
    },
    Reported {
        flow: FlowId,
        run: RunId,
    },
    /// The player reported `flow`, but its samples could not be kept.
    ReportFailed {
        flow: FlowId,
        error: String,
    },
    RunExported {
        run: RunId,
        path: PathBuf,
        reports: usize,
    },
    /// The report of `run` could not be written; its samples stay stored.
    RunExportFailed {
        run: RunId,
        error: String,
    },
}

/// Counts completed flows towards the next prompt.
#[derive(Debug, Default)]
struct Cadence {
    completed: u64,
    prompted_this_run: bool,
}

impl Cadence {
    /// Counts one completed flow and says whether to ask about it. A prompt
    /// that is shown counts even when it is ignored.
    fn completed(&mut self, prompting: Prompting) -> bool {
        self.completed += 1;
        let due = match prompting {
            Prompting::EveryNFlows(n) => self.completed % n.max(1) == 0,
            Prompting::OncePerRun => !self.prompted_this_run,
        };
        if due {
            self.prompted_this_run = true;
        }
        due
    }

    fn end_run(&mut self) {
        self.prompted_this_run = false;
    }
}

/// The state of opt-in testing for one app session.
pub struct Feedback<S> {
    store: S,
    config: Config,
    flows: FlowTracker,
    cadence: Cadence,
    prompt: Option<Flow>,
    run: RunId,
    reports: usize,
    run_ended: bool,
    inventory_after_end: bool,
    latest_inventory_at: Option<Millis>,
}

impl<S: SampleStore> Feedback<S> {
    /// `first_run` must not repeat a run id the store may still hold.
    pub fn new(store: S, config: Config, first_run: RunId) -> Feedback<S> {
        Feedback {
            store,
            config,
            flows: FlowTracker::new(),
            cadence: Cadence::default(),
            prompt: None,
            run: first_run,
            reports: 0,
            run_ended: false,
            inventory_after_end: false,
            latest_inventory_at: None,
        }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn config(&self) -> Config {
        self.config
    }

    pub fn prompt_visible(&self) -> bool {
        self.prompt.is_some()
    }

    /// Applies changed testing choices. Turning testing off closes a visible
    /// prompt; visits already being saved finish as usual.
    pub fn set_config(&mut self, config: Config) -> Vec<Notice> {
        self.config = config;
        let mut notices = Vec::new();
        if !config.enabled {
            self.close_prompt(&mut notices);
        }
        notices
    }

    /// A tracker visit started.
    pub fn enter(&mut self, visit: VisitId, screen: Screen) -> Vec<Notice> {
        let mut notices = Vec::new();
        for flow in self.flows.enter(visit, screen) {
            self.complete(flow, &mut notices);
        }
        if self.config.enabled {
            self.store.begin(visit);
        }
        notices
    }

    /// OCR read the title of an ambiguous relic list.
    pub fn reclassify(&mut self, visit: VisitId, screen: Screen) {
        self.flows.reclassify(visit, screen);
    }

    /// A tracker visit ended.
    pub fn leave(&mut self, visit: VisitId, screen: Screen) -> Vec<Notice> {
        let mut notices = Vec::new();
        if let Some(flow) = self.flows.leave(visit, screen) {
            self.complete(flow, &mut notices);
        }
        notices
    }

    /// Page Up (`correct`) or Page Down while the prompt is visible.
    pub fn answer(&mut self, correct: bool) -> Vec<Notice> {
        let mut notices = Vec::new();
        let Some(flow) = self.prompt.take() else {
            return notices;
        };
        notices.push(Notice::PromptHidden);
        if correct {
            self.store.discard(&flow);
            notices.push(Notice::Discarded {
                flow: flow.id,
                reason: DiscardReason::Correct,
            });
        } else {
            match self.store.keep(self.run, &flow) {
                Ok(()) => {
                    self.reports += 1;
                    notices.push(Notice::Reported {
                        flow: flow.id,
                        run: self.run,
                    });
                }
                Err(error) => {
                    self.store.discard(&flow);
                    notices.push(Notice::ReportFailed {
                        flow: flow.id,
                        error,
                    });
                }
            }
        }
        self.finish_run_if_ready(&mut notices);
        notices
    }

    /// The player closed the prompt without answering.
    pub fn dismiss(&mut self) -> Vec<Notice> {
        let mut notices = Vec::new();
        self.close_prompt(&mut notices);
        self.finish_run_if_ready(&mut notices);
        notices
    }

    /// The prompt for `flow` timed out. A timer for an older prompt does
    /// nothing.
    pub fn prompt_timeout(&mut self, flow: FlowId) -> Vec<Notice> {
        if self.prompt.as_ref().is_some_and(|prompt| prompt.id == flow) {
            self.dismiss()
        } else {
            Vec::new()
        }
    }

    /// The mission ended at `at`. Its report is written once the inventory
    /// update that follows has arrived and no prompt is waiting.
    pub fn run_ended(&mut self, at: Millis) -> Vec<Notice> {
        let mut notices = Vec::new();
        if let Some(flow) = self.flows.end_run() {
            self.complete(flow, &mut notices);
        }
        self.run_ended = true;
        self.inventory_after_end = self.latest_inventory_at.is_some_and(|seen| seen >= at);
        self.cadence.end_run();
        self.finish_run_if_ready(&mut notices);
        notices
    }

    /// A full inventory update arrived at `at`.
    pub fn inventory_updated(&mut self, at: Millis) -> Vec<Notice> {
        let mut notices = Vec::new();
        self.latest_inventory_at = Some(at);
        if self.run_ended {
            self.inventory_after_end = true;
            self.finish_run_if_ready(&mut notices);
        }
        notices
    }

    /// Removes every pending sample and unexported report. The run goes on;
    /// later flows are saved as usual.
    pub fn remove_all(&mut self) -> Result<Vec<Notice>, String> {
        let mut notices = Vec::new();
        if self.prompt.take().is_some() {
            notices.push(Notice::PromptHidden);
        }
        self.reports = 0;
        self.store.remove_all()?;
        Ok(notices)
    }

    fn complete(&mut self, flow: Flow, notices: &mut Vec<Notice>) {
        self.store.stop(&flow);
        notices.push(Notice::FlowCompleted(flow.clone()));
        let ask = self.config.enabled
            && self.store.has_samples(&flow)
            && self.cadence.completed(self.config.prompting);
        if !ask {
            self.store.discard(&flow);
            return;
        }
        self.close_prompt(notices);
        notices.push(Notice::PromptShown {
            flow: flow.id,
            kind: flow.kind,
        });
        self.prompt = Some(flow);
    }

    fn close_prompt(&mut self, notices: &mut Vec<Notice>) {
        let Some(flow) = self.prompt.take() else {
            return;
        };
        self.store.discard(&flow);
        notices.push(Notice::PromptHidden);
        notices.push(Notice::Discarded {
            flow: flow.id,
            reason: DiscardReason::Ignored,
        });
    }

    fn finish_run_if_ready(&mut self, notices: &mut Vec<Notice>) {
        if !self.run_ended || !self.inventory_after_end || self.prompt.is_some() {
            return;
        }
        if self.reports > 0 {
            match self.store.export(self.run) {
                Ok(path) => notices.push(Notice::RunExported {
                    run: self.run,
                    path,
                    reports: self.reports,
                }),
                Err(error) => notices.push(Notice::RunExportFailed {
                    run: self.run,
                    error,
                }),
            }
        }
        self.run += 1;
        self.reports = 0;
        self.run_ended = false;
        self.inventory_after_end = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    /// Records samples per visit in memory.
    #[derive(Default)]
    struct MemoryStore {
        saving: BTreeSet<VisitId>,
        pending: BTreeSet<VisitId>,
        reports: BTreeMap<RunId, Vec<FlowId>>,
        exported: Vec<RunId>,
        fail_keep: bool,
    }

    impl MemoryStore {
        fn sample(&mut self, visit: VisitId) {
            if self.saving.contains(&visit) {
                self.pending.insert(visit);
            }
        }
    }

    impl SampleStore for MemoryStore {
        fn begin(&mut self, visit: VisitId) {
            self.saving.insert(visit);
        }
        fn stop(&mut self, flow: &Flow) {
            for visit in &flow.visits {
                self.saving.remove(visit);
            }
        }
        fn has_samples(&self, flow: &Flow) -> bool {
            flow.visits.iter().any(|visit| self.pending.contains(visit))
        }
        fn discard(&mut self, flow: &Flow) {
            for visit in &flow.visits {
                self.pending.remove(visit);
            }
        }
        fn keep(&mut self, run: RunId, flow: &Flow) -> Result<(), String> {
            if self.fail_keep {
                return Err("disk full".to_string());
            }
            self.discard(flow);
            self.reports.entry(run).or_default().push(flow.id);
            Ok(())
        }
        fn export(&mut self, run: RunId) -> Result<PathBuf, String> {
            self.reports.remove(&run);
            self.exported.push(run);
            Ok(PathBuf::from(format!("run-{run}.zip")))
        }
        fn remove_all(&mut self) -> Result<(), String> {
            self.saving.clear();
            self.pending.clear();
            self.reports.clear();
            Ok(())
        }
    }

    const EVERY_FLOW: Config = Config {
        enabled: true,
        prompting: Prompting::EveryNFlows(1),
    };

    fn feedback(config: Config) -> Feedback<MemoryStore> {
        Feedback::new(MemoryStore::default(), config, 1)
    }

    /// One riven visit that saved a sample, entered and left.
    fn riven_flow(feedback: &mut Feedback<MemoryStore>, visit: VisitId) -> Vec<Notice> {
        feedback.enter(visit, Screen::Riven);
        feedback.store.sample(visit);
        feedback.leave(visit, Screen::Riven)
    }

    fn shown(notices: &[Notice]) -> bool {
        notices
            .iter()
            .any(|notice| matches!(notice, Notice::PromptShown { .. }))
    }

    #[test]
    fn cadence_counts_completed_flows_and_a_shown_prompt_counts() {
        let mut cadence = Cadence::default();
        let every_3 = Prompting::EveryNFlows(3);
        assert!(!cadence.completed(every_3));
        assert!(!cadence.completed(every_3));
        assert!(cadence.completed(every_3));
        assert!(!cadence.completed(every_3));
    }

    #[test]
    fn once_per_run_resets_only_at_run_end() {
        let mut cadence = Cadence::default();
        assert!(cadence.completed(Prompting::OncePerRun));
        assert!(!cadence.completed(Prompting::OncePerRun));
        cadence.end_run();
        assert!(cadence.completed(Prompting::OncePerRun));
    }

    #[test]
    fn nothing_is_saved_or_asked_while_testing_is_off() {
        let mut feedback = feedback(Config::OFF);
        let notices = riven_flow(&mut feedback, 1);
        assert!(!shown(&notices));
        assert!(feedback.store().pending.is_empty());
    }

    #[test]
    fn a_flow_without_samples_is_not_asked_about() {
        let mut feedback = feedback(EVERY_FLOW);
        feedback.enter(1, Screen::Riven);
        assert!(!shown(&feedback.leave(1, Screen::Riven)));
    }

    #[test]
    fn page_up_discards_and_page_down_reports() {
        let mut feedback = feedback(EVERY_FLOW);
        assert!(shown(&riven_flow(&mut feedback, 1)));
        feedback.answer(true);
        assert!(feedback.store().pending.is_empty());
        assert!(feedback.store().reports.is_empty());

        riven_flow(&mut feedback, 2);
        let notices = feedback.answer(false);
        assert!(notices.contains(&Notice::Reported { flow: 2, run: 1 }));
        assert_eq!(feedback.store().reports[&1], [2]);
    }

    #[test]
    fn a_flow_that_cannot_be_kept_is_discarded() {
        let mut feedback = feedback(EVERY_FLOW);
        feedback.store.fail_keep = true;
        riven_flow(&mut feedback, 1);
        let notices = feedback.answer(false);
        assert!(matches!(notices[1], Notice::ReportFailed { flow: 1, .. }));
        assert!(feedback.store().pending.is_empty());
    }

    #[test]
    fn a_newer_prompt_replaces_an_unanswered_one() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        let notices = riven_flow(&mut feedback, 2);
        assert!(notices.contains(&Notice::Discarded {
            flow: 1,
            reason: DiscardReason::Ignored
        }));
        assert!(shown(&notices));
        assert!(!feedback.store().pending.contains(&1));
    }

    /// Leaving one screen straight into another keeps the prompt for the
    /// flow that just ended.
    #[test]
    fn entering_the_next_screen_keeps_the_prompt() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.enter(2, Screen::RelicRefinement);
        assert!(feedback.prompt_visible());
    }

    #[test]
    fn an_old_timeout_does_not_close_a_newer_prompt() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        riven_flow(&mut feedback, 2);
        let flow_of_visit_1 = 1;
        assert!(feedback.prompt_timeout(flow_of_visit_1).is_empty());
        assert!(feedback.prompt_visible());
    }

    #[test]
    fn a_run_is_exported_after_its_inventory_update_and_only_with_reports() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        assert!(feedback.run_ended(100).is_empty());
        let notices = feedback.inventory_updated(150);
        assert!(matches!(
            notices[..],
            [Notice::RunExported {
                run: 1,
                reports: 1,
                ..
            }]
        ));

        feedback.run_ended(200);
        assert!(
            feedback.inventory_updated(250).is_empty(),
            "no reports, no zip"
        );
        assert_eq!(feedback.store().exported, [1]);
    }

    #[test]
    fn a_waiting_prompt_holds_the_export_until_it_is_answered() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        riven_flow(&mut feedback, 2);
        feedback.run_ended(100);
        assert!(feedback.inventory_updated(150).is_empty());
        let notices = feedback.answer(true);
        assert!(notices
            .iter()
            .any(|notice| matches!(notice, Notice::RunExported { run: 1, .. })));
    }

    #[test]
    fn an_inventory_update_before_the_run_end_does_not_count() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        feedback.inventory_updated(50);
        assert!(feedback.run_ended(100).is_empty());
        assert!(!feedback.inventory_updated(150).is_empty());
    }

    #[test]
    fn a_selection_without_rewards_completes_at_run_end() {
        let mut feedback = feedback(EVERY_FLOW);
        feedback.enter(1, Screen::RelicSelection);
        feedback.store.sample(1);
        feedback.leave(1, Screen::RelicSelection);
        assert!(shown(&feedback.run_ended(100)));
    }

    #[test]
    fn turning_testing_off_closes_the_prompt() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        let notices = feedback.set_config(Config::OFF);
        assert!(notices.contains(&Notice::PromptHidden));
        assert!(!feedback.prompt_visible());
    }

    #[test]
    fn removing_all_data_closes_the_prompt_and_forgets_reports() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        riven_flow(&mut feedback, 2);
        let notices = feedback.remove_all().expect("memory store never fails");
        assert_eq!(notices, [Notice::PromptHidden]);
        feedback.run_ended(100);
        assert!(feedback.inventory_updated(150).is_empty());
    }
}
