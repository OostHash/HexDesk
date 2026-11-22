//! The reward card reader on recorded fissure reward screens: reading a
//! screen with one engine, proposing a label, and scoring a read.

use std::path::Path;
use std::time::Instant;

use hexdesk_capture::{recognize_bmp_with, Frame, Provider, TextRead};
use hexdesk_overlays::read::reward::{read_reward_screen, RewardInput, RewardScreen};
use serde::{Deserialize, Serialize};

/// What a reward screen shows, stored next to the screen as
/// `<screen>.label.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    /// False until a person has checked the label against the screen.
    pub confirmed: bool,
    /// The number of cards EE.log announced for this screen, if known.
    pub squad_size: Option<usize>,
    /// The reward on each card, left to right, as the catalogue names it.
    pub cards: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review: Vec<String>,
}

/// One read of a reward screen by one engine.
pub struct Read {
    /// The reward named on each card, left to right.
    pub names: Vec<Option<String>>,
    /// What OCR read on each card.
    pub texts: Vec<String>,
    pub ocr_ms: f64,
    pub text: TextRead,
}

/// Every reward a relic can give, as (path, name): the list the reward
/// reader's own tests use, `src/backend/crates/overlays/tests/fixtures/relic-reward/rewards.txt`.
/// The app narrows it to the relics EE.log names; the bench reads against
/// all of them, the harder case.
pub fn catalog() -> Result<Vec<(String, String)>, String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../overlays/tests/fixtures/relic-reward/rewards.txt");
    let text =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(text
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(path, name)| (path.to_string(), name.to_string()))
        .collect())
}

/// Reads a reward screen the way Relic Reward does, with one engine.
pub fn read(
    provider: Provider,
    frame: &Frame,
    bmp: &[u8],
    catalog: &[(String, String)],
    squad_size: Option<usize>,
) -> Result<Read, String> {
    let started = Instant::now();
    let text = recognize_bmp_with(provider, bmp, frame.width, frame.height)?;
    let ocr_ms = started.elapsed().as_secs_f64() * 1000.0;
    let screen = read_reward_screen(&RewardInput {
        text: &text,
        frame,
        catalog,
        squad_size,
        player_names: &[],
    });
    let (names, texts) = match screen {
        RewardScreen::Cards(read) => read
            .cards
            .into_iter()
            .map(|card| (card.name, card.text))
            .unzip(),
        _ => (Vec::new(), Vec::new()),
    };
    Ok(Read {
        names,
        texts,
        ocr_ms,
        text,
    })
}

/// A label from what every engine named alike; where they differ the card
/// is left empty and the difference goes to `review`.
pub fn propose(reads: &[(Provider, Read)], squad_size: Option<usize>) -> Label {
    let count = reads.iter().map(|(_, r)| r.names.len()).max().unwrap_or(0);
    let mut review = Vec::new();
    let cards = (0..count)
        .map(|i| {
            let named: Vec<Option<&String>> = reads
                .iter()
                .map(|(_, r)| r.names.get(i).and_then(Option::as_ref))
                .collect();
            if named.windows(2).all(|w| w[0] == w[1]) {
                if let Some(Some(name)) = named.first() {
                    return name.to_string();
                }
            }
            review.push(format!(
                "card {}: {}",
                i + 1,
                reads
                    .iter()
                    .zip(&named)
                    .map(|((p, _), n)| format!("{} {:?}", p.id(), n))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            String::new()
        })
        .collect();
    Label {
        confirmed: false,
        squad_size,
        cards,
        review,
    }
}

/// How one read compares with a label.
#[derive(Debug, Clone, Serialize)]
pub struct Score {
    /// Cards the label states.
    pub expected: usize,
    /// Cards named right, in their place.
    pub correct: usize,
    /// Cards the read named something else, or more cards than the label.
    pub wrong: usize,
}

impl Score {
    pub fn exact(&self) -> bool {
        self.correct == self.expected && self.wrong == 0
    }
}

pub fn score(read: &Read, label: &Label) -> Score {
    let correct = label
        .cards
        .iter()
        .zip(&read.names)
        .filter(|(want, got)| got.as_deref() == Some(want.as_str()))
        .count();
    let named = read.names.iter().filter(|n| n.is_some()).count();
    Score {
        expected: label.cards.len(),
        correct,
        wrong: named - correct,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(names: &[Option<&str>]) -> Read {
        Read {
            names: names.iter().map(|n| n.map(str::to_string)).collect(),
            texts: Vec::new(),
            ocr_ms: 1.0,
            text: TextRead {
                engine: "test".to_string(),
                width: 1,
                height: 1,
                lines: Vec::new(),
            },
        }
    }

    #[test]
    fn a_card_counts_only_in_its_own_place() {
        let label = Label {
            confirmed: true,
            squad_size: None,
            cards: vec![
                "Forma Blueprint".to_string(),
                "Athodai Prime Barrel".to_string(),
            ],
            review: Vec::new(),
        };
        let s = score(
            &read(&[Some("Athodai Prime Barrel"), Some("Forma Blueprint")]),
            &label,
        );
        assert_eq!((s.correct, s.wrong), (0, 2));
        let s = score(&read(&[Some("Forma Blueprint"), None]), &label);
        assert_eq!((s.correct, s.wrong), (1, 0));
        assert!(!s.exact());
    }

    #[test]
    fn the_catalogue_reads() {
        let catalog = catalog().unwrap();
        assert!(catalog.iter().any(|(_, name)| name == "Forma Blueprint"));
    }
}
