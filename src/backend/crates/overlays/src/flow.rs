//! Logical screen flows used by opt-in testing.
//!
//! Tracker visits describe one stay on one screen. A feedback flow is wider:
//! relic selection and the reward screen belong together, while refinement
//! and riven each complete when their screen is left.
//!
//! In an endless fissure the next relic selection opens shortly after the
//! reward screen, and the tracker can see one selection as several visits,
//! for example when the vote timer restarts. Selections that follow each
//! other without a reward screen between them are one flow, so the pick
//! after a reward is reviewed with the reward it leads to.

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
    /// Whether the active flow has reached its reward screen.
    rewarded: bool,
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
            rewarded: false,
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
                    self.rewarded = true;
                    return Vec::new();
                }
                let completed = self.replace(visit, FlowKind::Reward);
                self.rewarded = true;
                completed
            }
            Screen::RelicSelection => {
                if !self.rewarded {
                    if let Some(flow) = self
                        .active
                        .as_mut()
                        .filter(|flow| flow.kind == FlowKind::Reward)
                    {
                        flow.visits.push(visit);
                        return Vec::new();
                    }
                }
                self.replace(visit, FlowKind::Reward)
            }
            Screen::RelicRefinement => self.replace(visit, FlowKind::Refinement),
            Screen::Riven => self.replace(visit, FlowKind::Riven),
        }
    }

    /// Corrects an ambiguous relic-list visit after OCR reads its title.
    /// A visit that joined a flow of another kind moves to a flow of its
    /// own; the flow it leaves is returned as complete.
    pub fn reclassify(&mut self, visit: VisitId, screen: Screen) -> Option<Flow> {
        let kind = match screen {
            Screen::RelicSelection | Screen::RewardChoice => FlowKind::Reward,
            Screen::RelicRefinement => FlowKind::Refinement,
            Screen::Riven => FlowKind::Riven,
        };
        let flow = self
            .active
            .as_mut()
            .filter(|flow| flow.visits.contains(&visit))?;
        if flow.kind == kind {
            return None;
        }
        if flow.visits.len() == 1 {
            flow.kind = kind;
            return None;
        }
        flow.visits.retain(|other| *other != visit);
        self.replace(visit, kind).into_iter().next()
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
        self.rewarded = false;
        self.active.take()
    }

    fn replace(&mut self, visit: VisitId, kind: FlowKind) -> Vec<Flow> {
        self.rewarded = false;
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
    fn selections_before_one_reward_screen_are_one_flow() {
        let mut tracker = FlowTracker::new();
        tracker.enter(50, Screen::RelicSelection);
        tracker.leave(50, Screen::RelicSelection);
        assert!(tracker.enter(51, Screen::RelicSelection).is_empty());
        tracker.leave(51, Screen::RelicSelection);
        tracker.enter(52, Screen::RewardChoice);
        let flow = tracker
            .leave(52, Screen::RewardChoice)
            .expect("reward flow completes");
        assert_eq!(flow.visits, [50, 51, 52]);
    }

    /// Endless fissures: reward, then the next selection, then its reward.
    #[test]
    fn the_selection_after_a_reward_starts_the_next_flow() {
        let mut tracker = FlowTracker::new();
        tracker.enter(53, Screen::RewardChoice);
        // The selection can open before the reward screen is seen to close.
        let completed = tracker.enter(54, Screen::RelicSelection);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].visits, [53]);
        assert!(tracker.leave(53, Screen::RewardChoice).is_none());
        tracker.leave(54, Screen::RelicSelection);
        assert!(tracker.enter(55, Screen::RelicSelection).is_empty());
        tracker.enter(56, Screen::RewardChoice);
        let flow = tracker
            .leave(56, Screen::RewardChoice)
            .expect("second reward flow completes");
        assert_eq!(flow.visits, [54, 55, 56]);
    }

    #[test]
    fn a_refinement_that_joined_a_selection_gets_its_own_flow() {
        let mut tracker = FlowTracker::new();
        tracker.enter(57, Screen::RelicSelection);
        tracker.leave(57, Screen::RelicSelection);
        tracker.enter(58, Screen::RelicSelection);
        let completed = tracker
            .reclassify(58, Screen::RelicRefinement)
            .expect("the selection completes");
        assert_eq!(completed.kind, FlowKind::Reward);
        assert_eq!(completed.visits, [57]);
        let active = tracker.active().expect("the refinement flow is active");
        assert_eq!(active.kind, FlowKind::Refinement);
        assert_eq!(active.visits, [58]);
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
