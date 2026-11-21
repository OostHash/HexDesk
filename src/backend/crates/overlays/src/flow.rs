//! Logical screen flows used by opt-in testing.
//!
//! Tracker visits describe one stay on one screen. A feedback flow is wider:
//! relic selection and the reward screen belong together, while refinement
//! and riven each complete when their screen is left.

use crate::{Screen, VisitId};

/// Identifies one logical flow; counts up from 1 for this app session.
pub type FlowId = u64;

/// The kinds of flow a player can review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowKind {
    Reward,
    Refinement,
    Riven,
}

impl FlowKind {
    pub const fn name(self) -> &'static str {
        match self {
            FlowKind::Reward => "reward",
            FlowKind::Refinement => "refinement",
            FlowKind::Riven => "riven",
        }
    }
}

/// One completed or active logical flow and the tracker visits it contains.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Flow {
    pub id: FlowId,
    pub kind: FlowKind,
    pub visits: Vec<VisitId>,
}

/// Groups tracker visits into feedback flows without doing I/O.
#[derive(Debug, Clone)]
pub struct FlowTracker {
    active: Option<Flow>,
    next_id: FlowId,
}

impl Default for FlowTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl FlowTracker {
    pub const fn new() -> FlowTracker {
        FlowTracker {
            active: None,
            next_id: 1,
        }
    }

    pub fn active(&self) -> Option<&Flow> {
        self.active.as_ref()
    }

    /// Starts or extends a flow. Any returned flow was displaced and is now
    /// complete.
    pub fn enter(&mut self, visit: VisitId, screen: Screen) -> Vec<Flow> {
        if self
            .active
            .as_ref()
            .is_some_and(|flow| flow.visits.contains(&visit))
        {
            return Vec::new();
        }

        match screen {
            Screen::RewardChoice => {
                if let Some(flow) = self
                    .active
                    .as_mut()
                    .filter(|flow| flow.kind == FlowKind::Reward)
                {
                    flow.visits.push(visit);
                    return Vec::new();
                }
                self.replace(visit, FlowKind::Reward)
            }
            Screen::RelicSelection => {
                // A new selection starts a new reward sequence. Repeated
                // signals for one visit were returned above.
                self.replace(visit, FlowKind::Reward)
            }
            Screen::RelicRefinement => self.replace(visit, FlowKind::Refinement),
            Screen::Riven => self.replace(visit, FlowKind::Riven),
        }
    }

    /// Corrects an ambiguous relic-list visit after OCR reads its title.
    /// Reclassification never creates another visit or flow id.
    pub fn reclassify(&mut self, visit: VisitId, screen: Screen) {
        let Some(flow) = self
            .active
            .as_mut()
            .filter(|flow| flow.visits.contains(&visit))
        else {
            return;
        };
        flow.kind = match screen {
            Screen::RelicSelection | Screen::RewardChoice => FlowKind::Reward,
            Screen::RelicRefinement => FlowKind::Refinement,
            Screen::Riven => FlowKind::Riven,
        };
    }

    /// Leaves one tracker visit. Selection waits for its reward screen;
    /// refinement, riven and the reward screen complete their flow here.
    pub fn leave(&mut self, visit: VisitId, screen: Screen) -> Option<Flow> {
        let flow = self.active.as_ref()?;
        if !flow.visits.contains(&visit) {
            return None;
        }
        let last_visit = flow.visits.last().copied() == Some(visit);
        let complete = match flow.kind {
            FlowKind::Reward => screen == Screen::RewardChoice && last_visit,
            FlowKind::Refinement | FlowKind::Riven => last_visit,
        };
        complete.then(|| self.active.take().expect("active flow was just read"))
    }

    /// Ends a run whose selection never reached a reward screen.
    pub fn end_run(&mut self) -> Option<Flow> {
        self.active.take()
    }

    fn replace(&mut self, visit: VisitId, kind: FlowKind) -> Vec<Flow> {
        let completed = self.active.take().into_iter().collect();
        self.active = Some(Flow {
            id: self.next_id,
            kind,
            visits: vec![visit],
        });
        self.next_id += 1;
        completed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relic_selection_and_reward_are_one_flow() {
        let mut tracker = FlowTracker::new();
        assert!(tracker.enter(10, Screen::RelicSelection).is_empty());
        assert!(tracker.leave(10, Screen::RelicSelection).is_none());
        assert!(tracker.enter(11, Screen::RewardChoice).is_empty());
        let flow = tracker
            .leave(11, Screen::RewardChoice)
            .expect("reward flow completes");
        assert_eq!(flow.kind, FlowKind::Reward);
        assert_eq!(flow.visits, [10, 11]);
    }

    #[test]
    fn refinement_and_riven_complete_when_left() {
        let mut tracker = FlowTracker::new();
        tracker.enter(20, Screen::RelicRefinement);
        assert_eq!(
            tracker.leave(20, Screen::RelicRefinement).unwrap().kind,
            FlowKind::Refinement
        );
        tracker.enter(21, Screen::Riven);
        assert_eq!(
            tracker.leave(21, Screen::Riven).unwrap().kind,
            FlowKind::Riven
        );
    }

    #[test]
    fn retries_of_one_visit_do_not_create_flows() {
        let mut tracker = FlowTracker::new();
        tracker.enter(30, Screen::Riven);
        assert!(tracker.enter(30, Screen::Riven).is_empty());
        assert_eq!(tracker.active().unwrap().visits, [30]);
    }

    #[test]
    fn ocr_can_reclassify_an_ambiguous_relic_list() {
        let mut tracker = FlowTracker::new();
        tracker.enter(40, Screen::RelicSelection);
        tracker.reclassify(40, Screen::RelicRefinement);
        let flow = tracker
            .leave(40, Screen::RelicSelection)
            .expect("refinement completes on leave");
        assert_eq!(flow.kind, FlowKind::Refinement);
        assert_eq!(flow.visits, [40]);
    }

    #[test]
    fn a_new_selection_completes_the_unanswered_sequence() {
        let mut tracker = FlowTracker::new();
        tracker.enter(50, Screen::RelicSelection);
        tracker.leave(50, Screen::RelicSelection);
        let completed = tracker.enter(51, Screen::RelicSelection);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].visits, [50]);
        assert_eq!(tracker.active().unwrap().visits, [51]);
    }

    #[test]
    fn run_end_completes_a_selection_without_rewards() {
        let mut tracker = FlowTracker::new();
        tracker.enter(60, Screen::RelicSelection);
        tracker.leave(60, Screen::RelicSelection);
        assert_eq!(tracker.end_run().unwrap().visits, [60]);
        assert!(tracker.active().is_none());
    }

    #[test]
    fn a_reward_screen_without_a_seen_selection_still_completes() {
        let mut tracker = FlowTracker::new();
        tracker.enter(70, Screen::RewardChoice);
        let flow = tracker
            .leave(70, Screen::RewardChoice)
            .expect("reward-only flow completes");
        assert_eq!(flow.visits, [70]);
    }
}
