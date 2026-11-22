//! The relic list reader on recorded screens: reading a screen with one
//! engine, proposing a label, and scoring a read against a label.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::time::Instant;

use hexdesk_capture::{recognize_bmp_with, Frame, Provider, TextRead};
use hexdesk_overlays::read::era_of_list;
use hexdesk_overlays::read::relic_list::{read_relic_list_with, Names, RelicList};
use serde::{Deserialize, Serialize};

use crate::data::Data;

/// One relic tile as a label states it, and as a read is compared with it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Tile {
    pub relic: String,
    pub refinement: String,
    /// Whether the player has it: the icon is not faded. Null when the read
    /// could not measure the icon.
    pub owned: Option<bool>,
    /// The count badge; null when the tile shows none.
    pub count: Option<u32>,
}

impl std::fmt::Display for Tile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.relic, self.refinement)?;
        match (self.owned, self.count) {
            (Some(false), _) => write!(f, " not owned"),
            (Some(true), Some(n)) => write!(f, " x{n}"),
            (Some(true), None) => write!(f, " owned"),
            (None, _) => write!(f, " unmeasured"),
        }
    }
}

/// What a relic list screen shows, stored next to the screen as
/// `<screen>.label.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    /// False until a person has checked the label against the screen.
    pub confirmed: bool,
    /// The era line, as the reader names it ("MESO").
    pub era: Option<String>,
    /// The "COLLECTED 9/10" counter.
    pub collected: Option<(u32, u32)>,
    /// Every relic tile on the screen whose name can be read.
    pub tiles: Vec<Tile>,
    /// Where the engines disagreed when the label was proposed: the place to
    /// look when checking it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review: Vec<String>,
}

/// One read of a screen by one engine.
pub struct Read {
    pub era: Option<&'static str>,
    pub list: Option<RelicList>,
    /// OCR time, the tile names read again included; matching is left out.
    pub ocr_ms: f64,
    /// What OCR read in the whole list.
    pub text: TextRead,
    /// Every part read again on its own, with what OCR read in it.
    pub parts: Vec<(Frame, Option<String>)>,
}

impl Read {
    /// The tiles the read named, as a label would state them.
    pub fn tiles(&self) -> Vec<Tile> {
        let mut tiles: Vec<Tile> = self
            .list
            .iter()
            .flat_map(|list| &list.tiles)
            .filter_map(|t| {
                Some(Tile {
                    relic: t.relic.clone()?,
                    refinement: t.refinement.to_string(),
                    owned: t.owned,
                    count: t.count,
                })
            })
            .collect();
        tiles.sort();
        tiles
    }

    pub fn collected(&self) -> Option<(u32, u32)> {
        self.list.as_ref().and_then(|list| list.collected)
    }
}

/// How a screen is read: the engine for the whole list, the engine that
/// reads refinement tags and count badges again on their own, and a second
/// engine for the names and count badges the first could not read.
#[derive(Debug, Clone, Copy)]
pub struct Variant {
    pub list: Provider,
    pub detail: Option<Provider>,
    pub fallback: Option<Provider>,
}

impl Variant {
    pub fn plain(list: Provider) -> Self {
        Self {
            list,
            detail: None,
            fallback: None,
        }
    }

    /// "windows", "windows+ocrs" with a detail engine, "windows+windows+ocrs"
    /// with a fallback engine too.
    pub fn name(&self) -> String {
        [Some(self.list), self.detail, self.fallback]
            .into_iter()
            .flatten()
            .map(Provider::id)
            .collect::<Vec<_>>()
            .join("+")
    }

    pub fn from_name(name: &str) -> Option<Self> {
        let engines = name
            .split('+')
            .map(Provider::from_id)
            .collect::<Option<Vec<_>>>()?;
        match engines[..] {
            [list] => Some(Self::plain(list)),
            [list, detail] => Some(Self {
                list,
                detail: Some(detail),
                fallback: None,
            }),
            [list, detail, fallback] => Some(Self {
                list,
                detail: Some(detail),
                fallback: Some(fallback),
            }),
            _ => None,
        }
    }
}

/// Relic names per era, loaded once per run.
pub struct Relics<'a> {
    data: &'a Data,
    eras: HashMap<&'static str, (Vec<String>, Vec<String>)>,
}

impl<'a> Relics<'a> {
    pub fn new(data: &'a Data) -> Self {
        Self {
            data,
            eras: HashMap::new(),
        }
    }

    fn of(&mut self, era: &'static str) -> Result<&(Vec<String>, Vec<String>), String> {
        if !self.eras.contains_key(era) {
            let names = (self.data.owned_relics(era)?, self.data.era_relics(era)?);
            self.eras.insert(era, names);
        }
        Ok(&self.eras[era])
    }
}

/// Reads a relic list screen the way the Relic Pick does.
pub fn read(
    variant: Variant,
    frame: &Frame,
    bmp: &[u8],
    relics: &mut Relics<'_>,
) -> Result<Read, String> {
    let started = Instant::now();
    let text = recognize_bmp_with(variant.list, bmp, frame.width, frame.height)?;
    let first_ms = started.elapsed().as_secs_f64() * 1000.0;
    let era = era_of_list(&text);
    let reread_ms = Cell::new(0.0);
    let parts = RefCell::new(Vec::new());
    let list = match era {
        Some(era) => {
            let (owned, all) = relics.of(era)?;
            let names = Names { owned, all };
            let read_with = |provider: Provider, part: &Frame| {
                let started = Instant::now();
                let text = recognize_bmp_with(provider, &part.to_bmp(), part.width, part.height)
                    .ok()
                    .map(|read| read.text().split_whitespace().collect::<Vec<_>>().join(" "))
                    .filter(|text| !text.is_empty());
                reread_ms.set(reread_ms.get() + started.elapsed().as_secs_f64() * 1000.0);
                parts.borrow_mut().push((part.clone(), text.clone()));
                text
            };
            let reread = |part: &Frame| read_with(variant.list, part);
            let detail = variant
                .detail
                .map(|provider| move |part: &Frame| read_with(provider, part));
            let detail = detail
                .as_ref()
                .map(|d| d as &dyn Fn(&Frame) -> Option<String>);
            let fallback = variant.fallback.map(|provider| {
                let parts = &parts;
                let reread_ms = &reread_ms;
                move |picture: &Frame| {
                    let started = Instant::now();
                    let read = recognize_bmp_with(
                        provider,
                        &picture.to_bmp(),
                        picture.width,
                        picture.height,
                    )
                    .ok();
                    reread_ms.set(reread_ms.get() + started.elapsed().as_secs_f64() * 1000.0);
                    let text = read
                        .as_ref()
                        .map(|r| r.text().split_whitespace().collect::<Vec<_>>().join(" "));
                    parts.borrow_mut().push((picture.clone(), text));
                    read
                }
            });
            let fallback = fallback
                .as_ref()
                .map(|b| b as &dyn Fn(&Frame) -> Option<TextRead>);
            Some(read_relic_list_with(
                &text, frame, &names, &reread, detail, fallback,
            ))
        }
        None => None,
    };
    Ok(Read {
        era,
        list,
        ocr_ms: first_ms + reread_ms.get(),
        text,
        parts: parts.into_inner(),
    })
}

/// A label from what every engine read alike. What only some engines read
/// goes to `review`.
pub fn propose(reads: &[(Provider, Read)]) -> Label {
    let mut review = Vec::new();
    let eras: Vec<Option<&str>> = reads.iter().map(|(_, r)| r.era).collect();
    if eras.windows(2).any(|w| w[0] != w[1]) {
        review.push(format!(
            "era: {}",
            describe(reads, |r| format!("{:?}", r.era))
        ));
    }
    let collected: Vec<_> = reads.iter().map(|(_, r)| r.collected()).collect();
    if collected.windows(2).any(|w| w[0] != w[1]) {
        review.push(format!(
            "collected: {}",
            describe(reads, |r| format!("{:?}", r.collected()))
        ));
    }
    let mut tiles = reads.first().map(|(_, r)| r.tiles()).unwrap_or_default();
    for (_, read) in &reads[1.min(reads.len())..] {
        tiles = common(&tiles, &read.tiles());
    }
    for (provider, read) in reads {
        let only: Vec<String> = minus(&read.tiles(), &tiles)
            .iter()
            .map(Tile::to_string)
            .collect();
        if !only.is_empty() {
            review.push(format!("only {}: {}", provider.id(), only.join(", ")));
        }
    }
    Label {
        confirmed: false,
        era: reads.iter().find_map(|(_, r)| r.era).map(str::to_string),
        collected: collected.into_iter().flatten().next(),
        tiles,
        review,
    }
}

fn describe(reads: &[(Provider, Read)], what: impl Fn(&Read) -> String) -> String {
    reads
        .iter()
        .map(|(provider, read)| format!("{} {}", provider.id(), what(read)))
        .collect::<Vec<_>>()
        .join(", ")
}

/// How one read compares with a label.
#[derive(Debug, Clone, Serialize)]
pub struct Score {
    pub era: bool,
    pub collected: bool,
    /// Tiles the label states.
    pub expected: usize,
    /// Of those, the ones the read named with every fact right.
    pub correct: usize,
    /// Tiles the read named that the label does not state: a wrong relic,
    /// refinement, ownership or count.
    pub wrong: usize,
    /// Tiles of relics the player has that the label states: the only tiles
    /// the Relic Pick offers.
    pub expected_owned: usize,
    /// Of those, the ones the read named with every fact right.
    pub correct_owned: usize,
}

impl Score {
    /// Everything the Relic Pick uses was read right.
    pub fn exact(&self) -> bool {
        self.era && self.collected && self.correct == self.expected && self.wrong == 0
    }
}

pub fn score(read: &Read, label: &Label) -> Score {
    let tiles = read.tiles();
    let mut expected = label.tiles.clone();
    expected.sort();
    let both = common(&tiles, &expected);
    let owned = |tiles: &[Tile]| tiles.iter().filter(|t| t.owned == Some(true)).count();
    let correct = both.len();
    Score {
        expected_owned: owned(&expected),
        correct_owned: owned(&both),
        era: read.era == label.era.as_deref(),
        collected: read.collected() == label.collected,
        expected: expected.len(),
        correct,
        wrong: tiles.len() - correct,
    }
}

/// The tiles in both sorted lists, counting repeats.
fn common(a: &[Tile], b: &[Tile]) -> Vec<Tile> {
    let (mut i, mut j, mut out) = (0, 0, Vec::new());
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[i].clone());
                i += 1;
                j += 1;
            }
        }
    }
    out
}

/// The tiles of sorted `a` that sorted `b` does not hold, counting repeats.
fn minus(a: &[Tile], b: &[Tile]) -> Vec<Tile> {
    let mut rest = b.to_vec();
    a.iter()
        .filter(|t| match rest.iter().position(|r| r == *t) {
            Some(at) => {
                rest.remove(at);
                false
            }
            None => true,
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(relic: &str, count: Option<u32>) -> Tile {
        Tile {
            relic: relic.to_string(),
            refinement: "Intact".to_string(),
            owned: Some(true),
            count,
        }
    }

    #[test]
    fn common_and_minus_count_repeats() {
        let a = vec![tile("Meso V13", None), tile("Meso V13", None)];
        let b = vec![tile("Meso V13", None)];
        assert_eq!(common(&a, &b).len(), 1);
        assert_eq!(minus(&a, &b).len(), 1);
    }

    #[test]
    fn a_tile_with_a_wrong_count_is_wrong_and_missed() {
        let label = Label {
            confirmed: true,
            era: Some("MESO".to_string()),
            collected: None,
            tiles: vec![tile("Meso V13", Some(3))],
            review: Vec::new(),
        };
        let read = Read {
            era: Some("MESO"),
            list: Some(RelicList {
                tiles: vec![hexdesk_overlays::read::relic_list::RelicTile {
                    text: "Meso V13".to_string(),
                    relic: Some("Meso V13".to_string()),
                    refinement: "Intact",
                    owned: Some(true),
                    count: Some(8),
                }],
                collected: None,
                complete: true,
            }),
            ocr_ms: 1.0,
            text: TextRead {
                engine: "test".to_string(),
                width: 1,
                height: 1,
                lines: Vec::new(),
            },
            parts: Vec::new(),
        };
        let score = score(&read, &label);
        assert_eq!((score.expected, score.correct, score.wrong), (1, 0, 1));
        assert!(!score.exact());
    }
}
