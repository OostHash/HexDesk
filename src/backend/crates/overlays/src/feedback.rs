//! Opt-in testing feedback: when to ask about a completed screen flow, what
//! happens to its samples, and which run a reported flow belongs to.
//!
//! [`Feedback`] does no I/O of its own. Samples go through a [`SampleStore`],
//! and everything the app shows or logs comes back as [`Notice`]s, so the
//! rules can be tested without the game, the disk or a window.
//!
//! Reported flows stay in the store until the player exports or discards
//! them; a report is never written on its own.

use std::path::PathBuf;

use crate::flow::{Flow, FlowId, FlowKind, FlowTracker};
use crate::screen::Screen;
use crate::tracker::VisitId;

/// Identifies one run; a report groups its reported flows by run.
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
    /// Moves the samples of `flow` to the reported flows of `run`.
    fn keep(&mut self, run: RunId, flow: &Flow) -> Result<(), String>;
    /// How many reported flows wait for an export, including those an
    /// earlier session left.
    fn kept(&self) -> usize;
    /// Writes every reported flow into one report, removes them and returns
    /// where the report was written.
    fn export(&mut self) -> Result<PathBuf, String>;
    /// Removes every reported flow; samples still pending stay.
    fn discard_reports(&mut self) -> Result<(), String>;
    /// Removes every pending sample and every reported flow.
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
}

/// A written report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Export {
    pub path: PathBuf,
    /// How many reported flows it holds.
    pub flows: usize,
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
            Prompting::EveryNFlows(n) => self.completed.is_multiple_of(n.max(1)),
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
    kept: usize,
    /// The mission ended while a prompt was up; the run changes once that
    /// prompt is answered or ignored, so its flow stays with the run it
    /// came from.
    run_ended: bool,
}

impl<S: SampleStore> Feedback<S> {
    /// `first_run` must not repeat a run id the store may still hold.
    pub fn new(store: S, config: Config, first_run: RunId) -> Feedback<S> {
        let kept = store.kept();
        Feedback {
            store,
            config,
            flows: FlowTracker::new(),
            cadence: Cadence::default(),
            prompt: None,
            run: first_run,
            kept,
            run_ended: false,
        }
    }

    /// How many reported flows wait for an export.
    pub fn kept(&self) -> usize {
        self.kept
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
    pub fn reclassify(&mut self, visit: VisitId, screen: Screen) -> Vec<Notice> {
        let mut notices = Vec::new();
        if let Some(flow) = self.flows.reclassify(visit, screen) {
            self.complete(flow, &mut notices);
        }
        notices
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
                    self.kept += 1;
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
        self.finish_run_if_ready();
        notices
    }

    /// The player closed the prompt without answering.
    pub fn dismiss(&mut self) -> Vec<Notice> {
        let mut notices = Vec::new();
        self.close_prompt(&mut notices);
        self.finish_run_if_ready();
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

    /// The mission ended. Flows reported from now on belong to the next
    /// run, except the one a visible prompt asks about.
    pub fn run_ended(&mut self) -> Vec<Notice> {
        let mut notices = Vec::new();
        if let Some(flow) = self.flows.end_run() {
            self.complete(flow, &mut notices);
        }
        self.run_ended = true;
        self.cadence.end_run();
        self.finish_run_if_ready();
        notices
    }

    /// Writes every reported flow into one report. Nothing is written when
    /// there is nothing to report; a failed write keeps the reported flows.
    pub fn export(&mut self) -> Result<Export, String> {
        if self.kept == 0 {
            return Err("Nothing is marked wrong yet, so there is nothing to export.".to_string());
        }
        let path = self.store.export()?;
        let flows = std::mem::take(&mut self.kept);
        Ok(Export { path, flows })
    }

    /// Removes every reported flow without writing a report.
    pub fn discard_reports(&mut self) -> Result<(), String> {
        self.store.discard_reports()?;
        self.kept = 0;
        Ok(())
    }

    /// Removes every pending sample and reported flow. The run goes on;
    /// later flows are saved as usual.
    pub fn remove_all(&mut self) -> Result<Vec<Notice>, String> {
        let mut notices = Vec::new();
        if self.prompt.take().is_some() {
            notices.push(Notice::PromptHidden);
        }
        self.store.remove_all()?;
        self.kept = 0;
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

    fn finish_run_if_ready(&mut self) {
        if self.run_ended && self.prompt.is_none() {
            self.run += 1;
            self.run_ended = false;
        }
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
        exported: Vec<BTreeMap<RunId, Vec<FlowId>>>,
        fail_keep: bool,
        fail_export: bool,
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
        fn kept(&self) -> usize {
            self.reports.values().map(Vec::len).sum()
        }
        fn export(&mut self) -> Result<PathBuf, String> {
            if self.fail_export {
                return Err("disk full".to_string());
            }
            self.exported.push(std::mem::take(&mut self.reports));
            Ok(PathBuf::from("report.zip"))
        }
        fn discard_reports(&mut self) -> Result<(), String> {
            self.reports.clear();
            Ok(())
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
    fn nothing_is_exported_until_the_player_asks() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        assert!(feedback.run_ended().is_empty());
        assert!(feedback.store().exported.is_empty());
        assert_eq!(feedback.kept(), 1);
    }

    #[test]
    fn one_export_holds_every_run_grouped_by_run() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        feedback.run_ended();
        riven_flow(&mut feedback, 2);
        feedback.answer(false);

        let export = feedback.export().expect("two flows were reported");
        assert_eq!(export.flows, 2);
        assert_eq!(
            feedback.store().exported,
            [BTreeMap::from([(1, vec![1]), (2, vec![2])])]
        );
        assert_eq!(feedback.kept(), 0);
        assert!(feedback.export().is_err(), "nothing left to export");
    }

    #[test]
    fn a_failed_export_keeps_the_reported_flows() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        feedback.store.fail_export = true;
        assert!(feedback.export().is_err());
        assert_eq!(feedback.kept(), 1);
    }

    #[test]
    fn flows_an_earlier_session_reported_count_as_kept() {
        let mut store = MemoryStore::default();
        store.reports.insert(7, vec![1, 2]);
        let feedback = Feedback::new(store, EVERY_FLOW, 8);
        assert_eq!(feedback.kept(), 2);
    }

    #[test]
    fn discarding_reports_keeps_nothing_and_writes_nothing() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.answer(false);
        feedback
            .discard_reports()
            .expect("memory store never fails");
        assert_eq!(feedback.kept(), 0);
        assert!(feedback.store().reports.is_empty());
        assert!(feedback.store().exported.is_empty());
    }

    #[test]
    fn a_prompt_answered_after_the_mission_stays_with_its_run() {
        let mut feedback = feedback(EVERY_FLOW);
        riven_flow(&mut feedback, 1);
        feedback.run_ended();
        let notices = feedback.answer(false);
        assert!(notices.contains(&Notice::Reported { flow: 1, run: 1 }));
        riven_flow(&mut feedback, 2);
        let notices = feedback.answer(false);
        assert!(notices.contains(&Notice::Reported { flow: 2, run: 2 }));
    }

    #[test]
    fn a_selection_without_rewards_completes_at_run_end() {
        let mut feedback = feedback(EVERY_FLOW);
        feedback.enter(1, Screen::RelicSelection);
        feedback.store.sample(1);
        feedback.leave(1, Screen::RelicSelection);
        assert!(shown(&feedback.run_ended()));
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
        assert_eq!(feedback.kept(), 0);
        assert!(feedback.store().reports.is_empty());
    }
}
