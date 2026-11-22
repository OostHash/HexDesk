//! When a read of the reward cards can be shown. The screen is read again
//! and again; each read is compared with the one before it, card by card.
//! The cards are shown once two reads in a row agree on every card. A card
//! is certain when it matched the same reward in both reads and its match
//! is sure; the overlay marks the others as uncertain.

use super::RewardRead;

/// Reads after the first complete one before cards that still differ are
/// shown as they are.
const SETTLE_READS: u32 = 3;

/// Identical reads with fewer cards than expected before they are shown:
/// a player may have left after EE.log counted the squad, or a card's name
/// matches no reward.
const SAME_PARTIAL_READS: u32 = 4;

/// A card as the overlay shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShownCard {
    /// The reward's path; None when the card matched nothing.
    pub item: Option<String>,
    /// The text OCR read on the card.
    pub text: String,
    pub x: f32,
    /// Two reads agree on the reward and the match is sure.
    pub sure: bool,
}

/// What to do after a read.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// Read again.
    Wait,
    Show {
        cards: Vec<ShownCard>,
        reason: &'static str,
    },
}

/// Compares the reads of one reward screen.
#[derive(Debug, Default)]
pub struct Confirm {
    previous: Option<RewardRead>,
    /// The read with the most matched cards so far, with which of its cards
    /// agreed with the read before it.
    best: Option<(RewardRead, Vec<bool>)>,
    /// Reads since the first complete read.
    since_complete: Option<u32>,
    /// Identical partial reads in a row.
    same_partial: u32,
}

impl Confirm {
    pub fn new() -> Confirm {
        Confirm::default()
    }

    /// Takes the next read. A read without a matched card says nothing about
    /// the cards and is passed over.
    pub fn add(&mut self, read: RewardRead) -> Verdict {
        if read.matched() == 0 {
            return Verdict::Wait;
        }
        let (same, agree) = compare(self.previous.as_ref(), &read);
        let agreed = agree.iter().filter(|a| **a).count();
        let better = self.best.as_ref().is_none_or(|(best, best_agree)| {
            let best_agreed = best_agree.iter().filter(|a| **a).count();
            (read.matched(), agreed) >= (best.matched(), best_agreed)
        });
        if better {
            self.best = Some((read.clone(), agree.clone()));
        }

        let complete = read.complete();
        if complete && self.since_complete.is_none() {
            self.since_complete = Some(0);
        } else if let Some(n) = self.since_complete.as_mut() {
            *n += 1;
        }
        self.same_partial = if !complete && same {
            self.same_partial + 1
        } else {
            0
        };

        let verdict = if complete && same {
            Verdict::Show {
                cards: shown(&read, &agree),
                reason: "two reads agree on every card",
            }
        } else if self.since_complete.is_some_and(|n| n >= SETTLE_READS) {
            Verdict::Show {
                cards: self.best_cards().unwrap_or_default(),
                reason: "cards still differ several reads after all were read",
            }
        } else if self.same_partial + 1 >= SAME_PARTIAL_READS {
            Verdict::Show {
                cards: shown(&read, &agree),
                reason: "the same read with fewer cards than expected, several times",
            }
        } else {
            Verdict::Wait
        };
        self.previous = Some(read);
        verdict
    }

    /// The best read so far, for when time is up; None when no read matched
    /// a card.
    pub fn best_cards(&self) -> Option<Vec<ShownCard>> {
        self.best.as_ref().map(|(read, agree)| shown(read, agree))
    }
}

/// Whether two reads show the same rewards on the same number of cards, and
/// which cards of `read` matched the same reward in both.
fn compare(previous: Option<&RewardRead>, read: &RewardRead) -> (bool, Vec<bool>) {
    let Some(previous) = previous.filter(|p| p.cards.len() == read.cards.len()) else {
        return (false, vec![false; read.cards.len()]);
    };
    let pairs = previous.cards.iter().zip(&read.cards);
    let same = pairs.clone().all(|(a, b)| a.item == b.item);
    let agree = pairs
        .map(|(a, b)| b.item.is_some() && a.item == b.item)
        .collect();
    (same, agree)
}

fn shown(read: &RewardRead, agree: &[bool]) -> Vec<ShownCard> {
    read.cards
        .iter()
        .zip(agree)
        .map(|(card, agreed)| ShownCard {
            item: card.item.clone(),
            text: card.text.clone(),
            x: card.x,
            sure: card.item.is_some() && *agreed && card.sure,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{CardCount, Columns, MatchedBy, RewardCard};
    use super::*;

    /// A read of cards by name; "?" is a card that matched nothing and a
    /// trailing "~" a match that is not sure.
    fn read(cards: &[&str], expected: usize) -> RewardRead {
        RewardRead {
            cards: cards
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let name = c.trim_end_matches('~');
                    let item = (name != "?").then(|| name.to_string());
                    RewardCard {
                        x: 0.3 + i as f32 * 0.12,
                        text: name.to_string(),
                        name: item.clone(),
                        item,
                        score: 1.0,
                        alternatives: Vec::new(),
                        matched_by: MatchedBy::Text,
                        sure: !c.ends_with('~'),
                    }
                })
                .collect(),
            expected,
            expected_from: CardCount::EeLog,
            columns: Columns::Bars,
            bars: String::new(),
            lines: Vec::new(),
        }
    }

    fn shown_as(verdict: &Verdict) -> Vec<String> {
        let Verdict::Show { cards, .. } = verdict else {
            panic!("not shown: {verdict:?}");
        };
        cards
            .iter()
            .map(|c| {
                let name = c.item.clone().unwrap_or_else(|| "?".into());
                if c.sure || c.item.is_none() {
                    name
                } else {
                    format!("{name}~")
                }
            })
            .collect()
    }

    #[test]
    fn two_reads_that_agree_are_shown_at_once() {
        let mut confirm = Confirm::new();
        assert_eq!(confirm.add(read(&["Lex", "Forma"], 2)), Verdict::Wait);
        let verdict = confirm.add(read(&["Lex", "Forma"], 2));
        assert_eq!(shown_as(&verdict), ["Lex", "Forma"]);
    }

    #[test]
    fn a_match_that_is_not_sure_is_shown_as_uncertain() {
        let mut confirm = Confirm::new();
        confirm.add(read(&["Wisp Neuroptics~", "Forma"], 2));
        let verdict = confirm.add(read(&["Wisp Neuroptics~", "Forma"], 2));
        assert_eq!(shown_as(&verdict), ["Wisp Neuroptics~", "Forma"]);
    }

    #[test]
    fn a_card_that_changes_waits_for_the_next_read() {
        let mut confirm = Confirm::new();
        confirm.add(read(&["Lex", "Forma"], 2));
        assert_eq!(confirm.add(read(&["Lex", "Bronco"], 2)), Verdict::Wait);
        let verdict = confirm.add(read(&["Lex", "Bronco"], 2));
        assert_eq!(shown_as(&verdict), ["Lex", "Bronco"]);
    }

    #[test]
    fn cards_that_keep_changing_are_shown_with_the_disagreeing_card_uncertain() {
        let mut confirm = Confirm::new();
        confirm.add(read(&["Lex", "Forma"], 2));
        confirm.add(read(&["Lex", "Bronco"], 2));
        confirm.add(read(&["Lex", "Forma"], 2));
        let verdict = confirm.add(read(&["Lex", "Bronco"], 2));
        assert_eq!(shown_as(&verdict), ["Lex", "Bronco~"]);
    }

    #[test]
    fn a_partial_read_is_shown_once_it_stays_the_same() {
        let mut confirm = Confirm::new();
        for _ in 0..SAME_PARTIAL_READS - 1 {
            assert_eq!(confirm.add(read(&["Lex", "?"], 3)), Verdict::Wait);
        }
        let verdict = confirm.add(read(&["Lex", "?"], 3));
        assert_eq!(shown_as(&verdict), ["Lex", "?"]);
    }

    #[test]
    fn reads_without_a_match_change_nothing() {
        let mut confirm = Confirm::new();
        confirm.add(read(&["Lex", "Forma"], 2));
        assert_eq!(confirm.add(read(&["?", "?"], 2)), Verdict::Wait);
        assert_eq!(confirm.best_cards().map(|c| c.len()), Some(2));
    }

    #[test]
    fn time_up_shows_the_read_with_the_most_cards() {
        let mut confirm = Confirm::new();
        confirm.add(read(&["Lex", "?", "?"], 3));
        confirm.add(read(&["Lex", "Forma", "?"], 3));
        confirm.add(read(&["Lex", "?", "?"], 3));
        let cards = confirm.best_cards().unwrap();
        assert_eq!(cards[1].item.as_deref(), Some("Forma"));
        assert!(cards[0].sure, "Lex agreed with the read before it");
        assert!(!cards[1].sure, "Forma was read once");
    }
}
