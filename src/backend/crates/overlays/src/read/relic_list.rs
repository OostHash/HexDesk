//! The relic tiles on a relic list (the relic selection and refinement
//! screens): which relics are shown, which the player has, and how many.
//!
//! The list is the left 60 % of the game screen. Each tile shows a relic
//! icon, its name under the icon ("Meso V13 Relic"), a refinement tag under
//! the name when it is not intact ("[Exceptional]") and a count badge in the
//! top-left corner when the player has more than one ("x4"). A relic the
//! player does not have is shown faded with an eye icon. Positions below are
//! fractions of the list picture.

use hexdesk_capture::{Frame, Rect, TextRead, Word};

/// The icon of a relic the player has is bright and detailed; a faded one
/// stays far below this brightest luminance (measured: 194 and up against
/// 148 and down, on every screen and background recorded).
const OWNED_ICON_LUMA: u8 = 170;

/// One relic tile.
#[derive(Debug, Clone, PartialEq)]
pub struct RelicTile {
    /// The name as OCR read it, without "Relic".
    pub text: String,
    /// The relic, such as "Meso V13", when the name matched one relic of
    /// the list's era.
    pub relic: Option<String>,
    /// "Intact", "Exceptional", "Flawless" or "Radiant".
    pub refinement: &'static str,
    /// Whether the player has it: the icon is not faded. None when the icon
    /// could not be measured.
    pub owned: Option<bool>,
    /// The count badge, when OCR read one.
    pub count: Option<u32>,
}

/// The tiles OCR found, left to right and top to bottom.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RelicList {
    pub tiles: Vec<RelicTile>,
    /// "COLLECTED 9/10" over the list: relics the player has and relics the
    /// list holds.
    pub collected: Option<(u32, u32)>,
    /// Every relic the player has fits on screen, so one that was not read can
    /// be treated as an uncertain on-screen tile. True when the list holds no
    /// more relics than one screen shows, or when a faded tile is on screen:
    /// the list puts the relics the player has before the faded ones.
    pub complete: bool,
}

/// How many tiles one screen of the list shows: four rows of four, less the
/// "No Relic" tile. A list that holds more scrolls.
const TILES_ON_SCREEN: u32 = 15;

fn list_fits_on_screen(collected: Option<(u32, u32)>) -> bool {
    collected.is_some_and(|(_, total)| total <= TILES_ON_SCREEN)
}

/// The top of the list holds the title, the era line and the filters; a
/// name there is the title ("VOID FISSURE/SELECT RELIC"), not a tile.
const LIST_TOP: f32 = 0.2;

/// Names right of this can be the panel describing the selected relic.
const PANEL_LEFT: f32 = 0.75;

/// Names in one row of tiles differ in height by less than this.
const ROW_TOLERANCE: f32 = 0.03;

/// Whether a word is "Relic", allowing one OCR error ("Rellc").
fn is_relic_word(text: &str) -> bool {
    let word = text
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .to_ascii_lowercase();
    edits(&word, "relic", |a, b| a == b) <= 1
}

/// The start of a word OCR joined to "Relic": "3" for "3Re1ic" in
/// "Neov 3Re1ic" (Neo V13 Relic). None when the word is no such join.
fn glued_name(text: &str) -> Option<&str> {
    let word = text.trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
    let at = word.char_indices().rev().nth(4)?.0;
    (at > 0 && is_relic_word(&word[at..])).then(|| &word[..at])
}

/// The words of each line, with a line OCR split off at "Relic" ("Meso Cl 1"
/// and "Relic" on the same height, side by side) joined back.
fn name_lines(read: &TextRead) -> Vec<Vec<&Word>> {
    let mut lines: Vec<Vec<&Word>> = read
        .lines
        .iter()
        .map(|l| l.words.iter().collect())
        .collect();
    let mut i = 0;
    while i < lines.len() {
        let has_relic = lines[i].iter().any(|w| is_relic_word(&w.text));
        let tail = lines[i].last().copied();
        if let (false, Some(tail)) = (has_relic, tail) {
            let next = lines.iter().position(|other| {
                other.first().is_some_and(|w| {
                    is_relic_word(&w.text)
                        && (w.top - tail.top).abs() < 0.01
                        && (0.0..0.03).contains(&(w.left - tail.right()))
                })
            });
            if let Some(j) = next {
                let moved = std::mem::take(&mut lines[j]);
                lines[i].extend(moved);
            }
        }
        i += 1;
    }
    lines
}

impl RelicList {
    /// One line per tile, for the log: "Meso Y2 x7, Meso D9 not owned, ?
    /// "Meso" owned".
    pub fn summary(&self) -> String {
        self.tiles
            .iter()
            .map(|t| {
                let name = match &t.relic {
                    Some(relic) => relic.clone(),
                    None => format!("? \"{}\"", t.text),
                };
                let refinement = if t.refinement == "Intact" {
                    String::new()
                } else {
                    format!(" {}", t.refinement)
                };
                let state = match (t.owned, t.count) {
                    (Some(false), _) => " not owned".to_string(),
                    (Some(true), Some(n)) => format!(" x{n}"),
                    (Some(true), None) => " owned".to_string(),
                    (None, _) => " unmeasured".to_string(),
                };
                format!("{name}{refinement}{state}")
            })
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Whether two reads say the same about the list: the same relics with
    /// the same refinement, ownership and count, the same counter and the
    /// same completeness. For a tile whose name was not identified only
    /// ownership counts, because its OCR text, refinement and badge change
    /// from read to read while the Relic Pick payload uses none of them.
    pub fn reads_the_same(&self, other: &RelicList) -> bool {
        self.facts() == other.facts()
    }

    fn facts(&self) -> TileFacts<'_> {
        let tiles = self
            .tiles
            .iter()
            .map(|t| match &t.relic {
                Some(relic) => (Some(relic.as_str()), t.refinement, t.owned, t.count),
                None => (None, "", t.owned, None),
            })
            .collect();
        (tiles, self.collected, self.complete)
    }
}

type TileFacts<'a> = (
    Vec<(Option<&'a str>, &'static str, Option<bool>, Option<u32>)>,
    Option<(u32, u32)>,
    bool,
);

/// Reads the text in a picture of part of the list; None when it read
/// nothing.
pub type ReadText<'a> = &'a dyn Fn(&Frame) -> Option<String>;

/// Reads a picture of part of the list with the place of each word.
pub type ReadLines<'a> = &'a dyn Fn(&Frame) -> Option<TextRead>;

/// What a name may be: `owned` are tried first (the relics the inventory
/// lists), then `all` (every relic of the era), as "Meso V13".
pub struct Names<'a> {
    pub owned: &'a [String],
    pub all: &'a [String],
}

/// Reads the relic tiles. `frame` is the picture `read` was made from.
/// `reread` reads a picture of one tile name on its own, which OCR gets
/// right more often than the same name within the whole list; it returns
/// None when it read nothing.
pub fn read_relic_list(
    read: &TextRead,
    frame: &Frame,
    names: &Names<'_>,
    reread: &dyn Fn(&Frame) -> Option<String>,
) -> RelicList {
    read_relic_list_with(read, frame, names, reread, None, None)
}

/// [`read_relic_list`], with extra reads for the small texts of a tile the
/// player has, which some engines skip within the whole list. When the list
/// read found none:
///
/// - `detail` reads the refinement tag and the count badge on their own;
/// - `fallback`, a second engine for what the first cannot read, reads a
///   tile name that no read named, and every count badge that shows but is
///   still not read, stacked in one picture so one OCR call covers them.
pub fn read_relic_list_with(
    read: &TextRead,
    frame: &Frame,
    names: &Names<'_>,
    reread: &dyn Fn(&Frame) -> Option<String>,
    detail: Option<ReadText<'_>>,
    fallback: Option<ReadLines<'_>>,
) -> RelicList {
    let words: Vec<&Word> = read.lines.iter().flat_map(|l| &l.words).collect();
    let mut tiles: Vec<(f32, f32, RelicTile)> = Vec::new();
    let lines = name_lines(read);
    let anchor = |line: &[&Word]| {
        line.iter()
            .position(|w| is_relic_word(&w.text) || glued_name(&w.text).is_some())
    };
    // Where the names with an anchor sit (top, centre): the rows and columns
    // of the tile grid.
    let anchored: Vec<(f32, f32)> = lines
        .iter()
        .filter_map(|line| {
            let at = anchor(line)?;
            let first = line.first()?;
            Some((first.top, (first.left + line[at].right()) / 2.0))
        })
        .collect();
    for line in &lines {
        let Some(first) = line.first() else {
            continue;
        };
        let (relic_at, center) = match anchor(line) {
            Some(at) => (at, (first.left + line[at].right()) / 2.0),
            // OCR sometimes loses "Relic" altogether ("Axi O" for "Axi P10
            // Relic"). A line that starts with an era name in a row and a
            // column of the grid is a tile name too; it takes the column's
            // centre, since the part read is shorter than the name.
            None => match unanchored_column(line, &anchored) {
                Some(center) => (line.len(), center),
                None => continue,
            },
        };
        let glued = line.get(relic_at).and_then(|w| glued_name(&w.text));
        let name_words = &line[..relic_at];
        let Some(first) = name_words.first().or_else(|| glued.and(line.get(relic_at))) else {
            continue;
        };
        if first.text.eq_ignore_ascii_case("no") || first.top < LIST_TOP {
            continue;
        }
        let tags = line.get(relic_at + 1..).unwrap_or(&[]);
        // The panel describing the selected relic heads its name with a dash:
        // "Meso Y2 Relic - Possible Rewards".
        if tags.iter().any(|w| w.text.starts_with(['-', '–'])) {
            continue;
        }
        let top = first.top;
        let text = name_words
            .iter()
            .map(|w| w.text.as_str())
            .chain(glued)
            .collect::<Vec<_>>()
            .join(" ");
        let mut refinement = refinement_in(tags.iter().copied())
            .or_else(|| refinement_below(&words, center, top))
            .unwrap_or("Intact");
        let mut count = count_badge(&words, center, top);
        // A name is tried against the relics the player has before every
        // relic of the era, and read again on its own when the list read
        // did not name one of those: "Meso VI" for V13 fits V1 among all
        // relics, but none the player has.
        let name_area = Rect::new(
            center - 0.075,
            center + 0.075,
            top - 0.008,
            top + first.height + 0.008,
        );
        let mut again: Option<Option<String>> = None;
        let mut read_again = || {
            again
                .get_or_insert_with(|| {
                    frame
                        .crop(name_area)
                        .ok()
                        .and_then(|part| reread(&part.upscale_2x().inverted()))
                        .map(|t| strip_relic_word(&t))
                })
                .clone()
        };
        let icon = Rect::new(center - 0.04, center + 0.04, top - 0.11, top - 0.03);
        let owned = frame.max_luma(icon).map(|luma| luma >= OWNED_ICON_LUMA);
        let mut text = text;
        // A faded tile is a relic the player does not have, so the relics
        // they have are no candidates for it.
        let faded = owned == Some(false);
        let mut relic = if faded {
            None
        } else {
            identify_owned(&text, names.owned)
        };
        if relic.is_none() && !faded {
            if let Some(t) = read_again() {
                relic = identify_owned(&t, names.owned);
                if relic.is_some() {
                    text = t;
                }
            }
        }
        if relic.is_none() {
            relic = identify(&text, names.all);
        }
        // A faded tile is not read again: the Relic Pick only offers relics
        // the player has, so its name is worth no extra OCR call.
        if relic.is_none() && !faded {
            if let Some(t) = read_again() {
                relic = identify(&t, names.all);
                if relic.is_some() {
                    text = t;
                }
            }
        }
        // Windows OCR drops the code of some names whatever the size
        // ("Meso K8 Relic" comes out as "Meso Relic"); a second engine reads
        // what the first could not.
        if let Some(fallback) = fallback.filter(|_| relic.is_none() && !faded) {
            let other = frame
                .crop(name_area)
                .ok()
                .and_then(|part| fallback(&part.upscale_2x().inverted()))
                .map(|read| strip_relic_word(&read.text()));
            if let Some(t) = other {
                relic = identify_owned(&t, names.owned).or_else(|| identify(&t, names.all));
                if relic.is_some() {
                    text = t;
                }
            }
        }
        let read_part = |detail: &dyn Fn(&Frame) -> Option<String>, area: Rect| {
            frame
                .crop(area)
                .ok()
                .and_then(|part| detail(&part.upscale_2x().inverted()))
        };
        if let Some(detail) = detail.filter(|_| owned == Some(true) && relic.is_some()) {
            if count.is_none() {
                count =
                    read_part(detail, badge_corner(&words, center, top)).and_then(|t| badge_in(&t));
            }
            if refinement == "Intact" {
                let below = top + first.height;
                let tag = Rect::new(center - 0.08, center + 0.08, below, below + 0.035);
                if let Some(found) = read_part(detail, tag).and_then(|t| refinement_from_text(&t)) {
                    refinement = found;
                }
            }
        }
        tiles.push((
            top,
            center,
            RelicTile {
                relic,
                text,
                refinement,
                owned,
                count,
            },
        ));
    }
    let orphans = orphan_tags(read, &tiles);
    for (center, tag_top, refinement) in orphans {
        if let Some(tile) = tile_above_tag(
            frame, &words, names, center, tag_top, reread, detail, fallback,
        ) {
            tiles.push((
                tag_top - NAME_ABOVE_TAG,
                center,
                RelicTile { refinement, ..tile },
            ));
        }
    }
    if let Some(fallback) = fallback {
        read_badges(frame, &words, &mut tiles, fallback);
    }
    // Rows are about 0.18 apart; names on one row differ in height by a
    // line at most.
    tiles.sort_by(|a, b| {
        ((a.0 / 0.09).round(), a.1)
            .partial_cmp(&((b.0 / 0.09).round(), b.1))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    // The panel describing the selected relic sits right of the list; its
    // name ("Meso D8 Relic [Excep", cut off at the edge of the picture) is
    // alone at its height, while tile names share their row.
    let alone_on_the_right = |i: usize| {
        let (top, center, _) = &tiles[i];
        *center > PANEL_LEFT
            && !tiles
                .iter()
                .enumerate()
                .any(|(j, (t, _, _))| j != i && (t - top).abs() < ROW_TOLERANCE)
    };
    let keep: Vec<bool> = (0..tiles.len()).map(|i| !alone_on_the_right(i)).collect();
    let tiles: Vec<RelicTile> = tiles
        .into_iter()
        .zip(keep)
        .filter(|(_, keep)| *keep)
        .map(|((_, _, t), _)| t)
        .collect();
    let collected = collected_in(read);
    // Whether every tile fits is a property of the list, not of OCR. A missed
    // tile must keep the list complete while remaining an uncertainty for the
    // payload builder; otherwise stale inventory relics look confirmed.
    let all_on_screen = list_fits_on_screen(collected);
    let complete = all_on_screen || tiles.iter().any(|t| t.owned == Some(false));
    RelicList {
        tiles,
        collected,
        complete,
    }
}

/// A tile name read on its own, without "Relic" and anything after it.
fn strip_relic_word(text: &str) -> String {
    text.split_whitespace()
        .take_while(|w| !is_relic_word(w))
        .collect::<Vec<_>>()
        .join(" ")
}

/// "COLLECTED 9/10" in the top of the list. OCR garbles the word
/// ("COW-ECTED"), so the first "a/b" there is taken.
fn collected_in(read: &TextRead) -> Option<(u32, u32)> {
    read.lines
        .iter()
        .filter(|l| l.words.first().is_some_and(|w| w.top < LIST_TOP))
        .flat_map(|l| &l.words)
        .find_map(|w| {
            let (a, b) = w.text.split_once('/')?;
            Some((a.parse().ok()?, b.parse().ok()?))
        })
}

const REFINEMENTS: [&str; 3] = ["Exceptional", "Flawless", "Radiant"];

fn refinement_in<'a>(words: impl Iterator<Item = &'a Word>) -> Option<&'static str> {
    let text = words.map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
    refinement_from_text(&text)
}

/// Matches the small fixed refinement vocabulary despite one or two OCR
/// errors. Words are compared separately as well as joined, because Windows
/// OCR sometimes splits a tag in the middle.
fn refinement_from_text(text: &str) -> Option<&'static str> {
    let tokens: Vec<String> = text
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    let joined = tokens.concat();
    let mut samples: Vec<&str> = tokens.iter().map(String::as_str).collect();
    if !joined.is_empty() {
        samples.push(&joined);
    }

    let mut best: Option<(usize, &'static str)> = None;
    let mut tie = false;
    for refinement in REFINEMENTS {
        let target = refinement.to_ascii_lowercase();
        let cost = samples
            .iter()
            .map(|sample| edits(sample, &target, |a, b| a == b))
            .min()
            .unwrap_or(usize::MAX);
        // These words only occur in the narrow refinement-tag area. Two
        // edits recover common short reads such as "Radiam" without making
        // unrelated UI words competitive with this vocabulary.
        let tolerance = 2;
        if cost > tolerance {
            continue;
        }
        match best {
            Some((best_cost, _)) if cost > best_cost => {}
            Some((best_cost, _)) if cost == best_cost => tie = true,
            _ => {
                best = Some((cost, refinement));
                tie = false;
            }
        }
    }
    best.filter(|_| !tie).map(|(_, refinement)| refinement)
}

/// A refinement tag on the line under a tile's name.
fn refinement_below(words: &[&Word], center: f32, top: f32) -> Option<&'static str> {
    refinement_in(words.iter().copied().filter(|w| {
        let dy = w.top - top;
        dy > 0.0 && dy < 0.04 && (w.center_x() - center).abs() < 0.08
    }))
}

/// The era word a tile name starts with.
const ERAS: [&str; 5] = ["Lith", "Meso", "Neo", "Axi", "Requiem"];

/// The column centre of a line without "Relic" that is still a tile name:
/// it starts with an era word and shares a row with, and lines up under, a
/// name that has one. None when it is no such line.
fn unanchored_column(line: &[&Word], anchored: &[(f32, f32)]) -> Option<f32> {
    let first = line.first()?;
    if !ERAS.contains(&first.text.as_str()) {
        return None;
    }
    let in_row = anchored
        .iter()
        .any(|(top, _)| (top - first.top).abs() < ROW_TOLERANCE);
    let start = first.left;
    let column = anchored
        .iter()
        .map(|&(_, center)| center)
        .filter(|center| (center - start - 0.04).abs() < 0.04)
        .min_by(|a, b| (a - start).abs().total_cmp(&(b - start).abs()))?;
    in_row.then_some(column)
}

/// How far a one-line name sits above its refinement tag ("Neo K10 Relic"
/// over "[Exceptional]"), measured on recorded relic lists.
const NAME_ABOVE_TAG: f32 = 0.017;

/// Refinement tags ("[Exceptional]") with no tile name above them: OCR
/// dropped that name. Each as (centre, top, refinement).
fn orphan_tags(read: &TextRead, tiles: &[(f32, f32, RelicTile)]) -> Vec<(f32, f32, &'static str)> {
    read.lines
        .iter()
        .filter(|line| line.text.trim_start().starts_with('['))
        .filter_map(|line| {
            let (first, last) = (line.words.first()?, line.words.last()?);
            let refinement = refinement_from_text(&line.text)?;
            Some(((first.left + last.right()) / 2.0, first.top, refinement))
        })
        .filter(|&(center, top, _)| {
            top >= LIST_TOP
                && !tiles.iter().any(|(t, c, _)| {
                    let dy = top - t;
                    dy > 0.0 && dy < 0.04 && (center - c).abs() < 0.08
                })
        })
        .collect()
}

/// Reads the name above an orphan refinement tag on its own, with the list
/// engine and then the fallback. Only a tile the player has is read: the
/// Relic Pick offers no other.
#[allow(clippy::too_many_arguments)]
fn tile_above_tag(
    frame: &Frame,
    words: &[&Word],
    names: &Names<'_>,
    center: f32,
    tag_top: f32,
    reread: &dyn Fn(&Frame) -> Option<String>,
    detail: Option<ReadText<'_>>,
    fallback: Option<ReadLines<'_>>,
) -> Option<RelicTile> {
    let top = tag_top - NAME_ABOVE_TAG;
    let icon = Rect::new(center - 0.04, center + 0.04, top - 0.11, top - 0.03);
    let owned = frame.max_luma(icon).map(|luma| luma >= OWNED_ICON_LUMA);
    if owned != Some(true) {
        return None;
    }
    let area = frame
        .crop(Rect::new(
            center - 0.075,
            center + 0.075,
            top - 0.008,
            tag_top,
        ))
        .ok()?
        .upscale_2x()
        .inverted();
    let named = |text: Option<String>| {
        let text = strip_relic_word(&text?);
        let relic = identify_owned(&text, names.owned).or_else(|| identify(&text, names.all))?;
        Some((relic, text))
    };
    let (relic, text) = named(reread(&area))
        .or_else(|| named(fallback.and_then(|f| f(&area)).map(|read| read.text())))?;
    let count = count_badge(words, center, top).or_else(|| {
        let part = frame.crop(badge_corner(words, center, top)).ok()?;
        detail?(&part.upscale_2x().inverted()).and_then(|t| badge_in(&t))
    });
    Some(RelicTile {
        relic: Some(relic),
        text,
        refinement: "Intact",
        owned,
        count,
    })
}

/// Where a tile's count badge shows, in its top-left corner: measured at
/// 0.045 to 0.066 left of the name's centre and 0.110 to 0.125 above it, with
/// a margin. A larger area catches the name of the tile above. On the relic
/// last equipped, a "Last Equipped" header takes that place and the badge
/// sits 0.03 lower.
fn badge_corner(words: &[&Word], center: f32, top: f32) -> Rect {
    let below_header = if last_equipped(words, center, top) {
        BADGE_UNDER_HEADER
    } else {
        0.0
    };
    Rect::new(
        center - 0.08,
        center - 0.03,
        top - 0.135 + below_header,
        top - 0.10 + below_header,
    )
}

/// How much lower a badge sits under a "Last Equipped" header.
const BADGE_UNDER_HEADER: f32 = 0.03;

/// Whether the tile shows the "Last Equipped" header in its top-left corner.
fn last_equipped(words: &[&Word], center: f32, top: f32) -> bool {
    words.iter().any(|w| {
        let x = w.center_x();
        let y = w.center_y();
        w.text.eq_ignore_ascii_case("last")
            && (center - 0.10..center + 0.02).contains(&x)
            && (top - 0.15..top - 0.10).contains(&y)
    })
}

/// Light pixels a badge leaves in a tile corner, as a share of the corner:
/// "x3" covers about 1 %, the specks of the game's background 0.1 %
/// (measured on recorded relic lists, where badge text peaks at 164).
const BADGE_SHARE: f32 = 0.004;
const BADGE_LUMA: u8 = 120;

/// Whether a count badge shows in a corner of the list picture.
fn badge_shown(frame: &Frame, corner: Rect) -> bool {
    let Ok(part) = frame.crop(corner) else {
        return false;
    };
    let light = part
        .pixels
        .chunks_exact(4)
        .filter(|px| px[0].max(px[1]).max(px[2]) >= BADGE_LUMA)
        .count();
    light as f32 >= (part.width * part.height) as f32 * BADGE_SHARE
}

/// Reads the badges of owned, named tiles that have no count yet and show
/// one, stacked under each other in one picture, and gives each tile the
/// count read in its own part.
fn read_badges(
    frame: &Frame,
    words: &[&Word],
    tiles: &mut [(f32, f32, RelicTile)],
    badges: ReadLines<'_>,
) {
    let wanted: Vec<(usize, Frame)> = tiles
        .iter()
        .enumerate()
        .filter(|(_, (_, _, t))| t.owned == Some(true) && t.relic.is_some() && t.count.is_none())
        .filter_map(|(i, (top, center, _))| {
            let corner = badge_corner(words, *center, *top);
            badge_shown(frame, corner)
                .then(|| frame.crop(corner).ok())
                .flatten()
                .map(|part| (i, part.upscale_2x().inverted()))
        })
        .collect();
    if wanted.is_empty() {
        return;
    }
    let parts: Vec<&Frame> = wanted.iter().map(|(_, part)| part).collect();
    let (picture, spans) = stack(&parts, 40);
    let Some(read) = badges(&picture) else {
        return;
    };
    let mut words: Vec<Vec<&str>> = vec![Vec::new(); spans.len()];
    for word in read.lines.iter().flat_map(|l| &l.words) {
        let y = word.center_y() * picture.height as f32;
        if let Some(at) = spans
            .iter()
            .position(|&(a, b)| (a as f32..b as f32).contains(&y))
        {
            words[at].push(&word.text);
        }
    }
    // A corner in the top row also catches the search box above the list,
    // so the badge is looked for word by word before in the whole part.
    for ((i, _), words) in wanted.iter().zip(words) {
        tiles[*i].2.count = words
            .iter()
            .find_map(|w| badge_from_text(w))
            .or_else(|| badge_from_text(&words.concat()));
    }
}

/// Pictures under each other on white, `gap` pixels apart, with the rows
/// each one takes.
fn stack(parts: &[&Frame], gap: u32) -> (Frame, Vec<(u32, u32)>) {
    let width = parts.iter().map(|p| p.width).max().unwrap_or(1);
    let height = parts.iter().map(|p| p.height + gap).sum::<u32>() + gap;
    let mut pixels = vec![255u8; (width * height * 4) as usize];
    let mut spans = Vec::with_capacity(parts.len());
    let mut y = gap;
    for part in parts {
        let row_bytes = (part.width * 4) as usize;
        for row in 0..part.height {
            let src = (row * part.width * 4) as usize;
            let dst = ((y + row) * width * 4) as usize;
            pixels[dst..dst + row_bytes].copy_from_slice(&part.pixels[src..src + row_bytes]);
        }
        spans.push((y, y + part.height));
        y += part.height + gap;
    }
    (Frame::new(pixels, width, height), spans)
}

/// The count badge in a part read on its own, word by word: the part can
/// also hold a "Last Equipped" header.
fn badge_in(text: &str) -> Option<u32> {
    text.split_whitespace()
        .find_map(badge_from_text)
        .or_else(|| badge_from_text(text))
}

/// A count badge read on its own: "x4", also as "X 4"; a badge shows two or
/// more.
fn badge_from_text(text: &str) -> Option<u32> {
    let text: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let count: u32 = text.trim_start_matches(['x', 'X', '×']).parse().ok()?;
    (count >= 2).then_some(count)
}

/// The count badge in the tile's top-left corner: "x4".
fn count_badge(words: &[&Word], center: f32, top: f32) -> Option<u32> {
    words.iter().find_map(|w| {
        let x = w.center_x();
        let y = w.center_y();
        let in_corner =
            (center - 0.10..center - 0.02).contains(&x) && (top - 0.17..top - 0.07).contains(&y);
        if !in_corner {
            return None;
        }
        let digits = w.text.strip_prefix(['x', 'X', '×'])?;
        digits.parse().ok()
    })
}

/// The relic a tile name names: the era word and the code ("V13") are
/// compared with tolerance for letters OCR confuses. One missing or extra
/// character is accepted when the first character still fits and exactly one
/// candidate wins. This lets the owned-name pass recover `V13` from `V3`
/// without guessing when a short read fits several relics equally well.
/// None when no relic or more than one fits equally well.
pub fn identify(text: &str, relics: &[String]) -> Option<String> {
    let mut parts = text.split_whitespace();
    let era = parts.next()?;
    let code: String = parts
        .collect::<String>()
        .replace("\\./", "V")
        .replace("\\/", "V")
        .to_uppercase();
    if code.is_empty() {
        return None;
    }
    let mut best: Option<(usize, &String)> = None;
    let mut tie = false;
    for relic in relics {
        let mut rp = relic.split_whitespace();
        let (Some(r_era), Some(r_code)) = (rp.next(), rp.next()) else {
            continue;
        };
        if edits(&era.to_uppercase(), &r_era.to_uppercase(), |a, b| a == b) > 1 {
            continue;
        }
        let r_code = r_code.to_uppercase();
        let cost = edits(&code, &r_code, look_alike);
        // Never guess from one surviving character, and keep the first
        // character stable: it carries most of a relic code's identity.
        let first_fits = matches!(
            (code.chars().next(), r_code.chars().next()),
            (Some(a), Some(b)) if look_alike(a, b)
        );
        if cost > 0 && (code.chars().count() < 2 || !first_fits) {
            continue;
        }
        match best {
            Some((b, _)) if cost > b => {}
            Some((b, _)) if cost == b => tie = true,
            _ => {
                best = Some((cost, relic));
                tie = false;
            }
        }
    }
    match best {
        Some((cost, relic)) if cost <= 1 && !tie => Some(relic.clone()),
        _ => None,
    }
}

/// The owned relic list is a much smaller, safer candidate set. If the usual
/// era/code parse fails, compare the complete normalized name so a lost space
/// (`NeoK o`) or digit can still recover the one owned relic that fits.
fn identify_owned(text: &str, relics: &[String]) -> Option<String> {
    identify(text, relics).or_else(|| {
        let read = normalized_relic_name(text);
        if read.len() < 4 {
            return None;
        }
        let mut best: Option<(usize, &String)> = None;
        let mut tie = false;
        for relic in relics {
            let candidate = normalized_relic_name(relic);
            let cost = edits(&read, &candidate, look_alike);
            match best {
                Some((best_cost, _)) if cost > best_cost => {}
                Some((best_cost, _)) if cost == best_cost => tie = true,
                _ => {
                    best = Some((cost, relic));
                    tie = false;
                }
            }
        }
        match best {
            Some((cost, relic)) if cost <= 1 && !tie => Some(relic.clone()),
            _ => None,
        }
    })
}

fn normalized_relic_name(text: &str) -> String {
    text.replace("\\./", "V")
        .replace("\\/", "V")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

/// Characters OCR reads for one another on relic tiles.
fn look_alike(read: char, real: char) -> bool {
    if read == real {
        return true;
    }
    matches!(
        (read, real),
        ('I' | 'L' | 'T' | '|' | '!' | 'J', '1')
            | ('O' | 'D' | 'Q', '0')
            | ('G', '9')
            | ('S', '5')
            | ('Z', '2')
            | ('B' | '6' | '8', 'D')
            | ('B', '8')
            | ('6', 'G')
    )
}

/// Edit distance where a substitution of characters `same` takes as equal
/// costs nothing.
fn edits(a: &str, b: &str, same: impl Fn(char, char) -> bool) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, &ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, &cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(!same(ca, cb));
            cur[j + 1] = sub.min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meso() -> Vec<String> {
        [
            "A12", "C1", "C11", "D8", "D9", "K8", "K9", "L5", "V13", "V15", "V17", "X1", "Y2",
        ]
        .iter()
        .map(|c| format!("Meso {c}"))
        .collect()
    }

    fn tile(relic: Option<&str>, text: &str, owned: bool, count: Option<u32>) -> RelicTile {
        RelicTile {
            text: text.to_string(),
            relic: relic.map(str::to_string),
            refinement: "Intact",
            owned: Some(owned),
            count,
        }
    }

    fn list(tiles: Vec<RelicTile>) -> RelicList {
        RelicList {
            tiles,
            collected: Some((2, 3)),
            complete: true,
        }
    }

    #[test]
    fn reads_differing_only_in_unidentified_text_are_the_same() {
        let first = list(vec![
            tile(Some("Meso Y2"), "Meso Y2", true, Some(7)),
            tile(None, "Meso O T", true, None),
        ]);
        let mut second = list(vec![
            tile(Some("Meso Y2"), "Meso Yz", true, Some(7)),
            tile(None, "Mes0", true, Some(3)),
        ]);
        second.tiles[1].refinement = "Radiant";
        assert!(first.reads_the_same(&second));
        assert_ne!(first.summary(), second.summary());
    }

    #[test]
    fn reads_differing_in_what_the_list_shows_are_not_the_same() {
        let base = || list(vec![tile(Some("Meso Y2"), "Meso Y2", true, Some(7))]);
        let mut count = base();
        count.tiles[0].count = Some(6);
        let mut owned = base();
        owned.tiles[0].owned = Some(false);
        let mut refinement = base();
        refinement.tiles[0].refinement = "Flawless";
        let mut relic = base();
        relic.tiles[0].relic = Some("Meso D9".to_string());
        let mut unidentified = base();
        unidentified.tiles[0].relic = None;
        let mut collected = base();
        collected.collected = Some((3, 3));
        let mut complete = base();
        complete.complete = false;
        for other in [
            count,
            owned,
            refinement,
            relic,
            unidentified,
            collected,
            complete,
        ] {
            assert!(!base().reads_the_same(&other), "{}", other.summary());
        }
    }

    #[test]
    fn names_as_ocr_read_them_in_the_game() {
        let relics = meso();
        for (read, relic) in [
            ("Meso VI 3", Some("Meso V13")),
            ("Meso A1 2", Some("Meso A12")),
            ("Meso Cl T", Some("Meso C11")),
            ("Meso b8", Some("Meso D8")),
            ("Meso 68", Some("Meso D8")),
            ("Meso Y2", Some("Meso Y2")),
            ("Meso", None),
        ] {
            assert_eq!(identify(read, &relics).as_deref(), relic, "{read}");
        }
    }

    #[test]
    fn other_eras_and_garbled_codes() {
        let neo: Vec<String> = ["C7", "C9", "C10", "V12", "V13", "A1", "E1"]
            .iter()
            .map(|c| format!("Neo {c}"))
            .collect();
        assert_eq!(identify("Neo CIO", &neo).as_deref(), Some("Neo C10"));
        assert_eq!(identify("Neo cg", &neo).as_deref(), Some("Neo C9"));
        assert_eq!(identify("Neo \\/12", &neo).as_deref(), Some("Neo V12"));
        assert_eq!(identify("Neo \\./13", &neo).as_deref(), Some("Neo V13"));
        // "1" fits A1 and E1 equally.
        assert_eq!(identify("Neo 1", &neo), None);
        // Another era's relic is never taken.
        assert_eq!(identify("Meso C7", &neo), None);
    }

    #[test]
    fn a_unique_owned_code_can_recover_one_missing_character() {
        let owned = vec!["Neo V13".to_string()];
        assert_eq!(identify_owned("Neo V3", &owned).as_deref(), Some("Neo V13"));

        let ambiguous = vec!["Neo V13".to_string(), "Neo V15".to_string()];
        assert_eq!(identify_owned("Neo V1", &ambiguous), None);
    }

    #[test]
    fn a_unique_owned_name_can_recover_a_lost_space_and_digit() {
        let owned = vec![
            "Neo T11".to_string(),
            "Neo K10".to_string(),
            "Neo V13".to_string(),
        ];
        assert_eq!(identify_owned("NeoK o", &owned).as_deref(), Some("Neo K10"));
    }

    #[test]
    fn refinement_words_allow_small_ocr_errors() {
        for (read, expected) in [
            ("[Exceptlonal]", Some("Exceptional")),
            ("[Flawles5]", Some("Flawless")),
            ("[Radiam]", Some("Radiant")),
            ("[Excep tio nal]", Some("Exceptional")),
            ("Owned", None),
        ] {
            assert_eq!(refinement_from_text(read), expected, "{read}");
        }
    }

    fn word(text: &str, left: f32, top: f32) -> Word {
        Word {
            text: text.to_string(),
            left,
            top,
            width: 0.03,
            height: 0.015,
        }
    }

    #[test]
    fn an_era_line_without_relic_takes_its_grid_column() {
        let anchored = [(0.317, 0.337), (0.317, 0.525), (0.506, 0.337)];
        let axi = word("Axi", 0.294, 0.317);
        let o = word("O", 0.33, 0.317);
        assert_eq!(unanchored_column(&[&axi, &o], &anchored), Some(0.337));
        let search = word("SEARCH...", 0.294, 0.317);
        assert_eq!(unanchored_column(&[&search], &anchored), None);
        let lower = word("Axi", 0.294, 0.694);
        assert_eq!(unanchored_column(&[&lower], &anchored), None);
    }

    #[test]
    fn a_name_joined_to_relic_is_split_off() {
        assert_eq!(glued_name("3Re1ic"), Some("3"));
        assert_eq!(glued_name("V13Relic."), Some("V13"));
        assert_eq!(glued_name("Relic"), None);
        assert_eq!(glued_name("Radiant"), None);
        assert_eq!(glued_name("Exceptional"), None);
    }

    #[test]
    fn stacked_parts_keep_their_rows() {
        let a = Frame::new(vec![0; 2 * 3 * 4], 2, 3);
        let b = Frame::new(vec![0; 2 * 4], 1, 2);
        let (picture, spans) = stack(&[&a, &b], 4);
        assert_eq!((picture.width, picture.height), (2, 3 + 2 + 3 * 4));
        assert_eq!(spans, [(4, 7), (11, 13)]);
        assert_eq!(picture.pixels[0], 255);
        assert_eq!(picture.pixels[(4 * 2) * 4], 0);
    }

    #[test]
    fn a_badge_under_a_last_equipped_header() {
        assert_eq!(badge_in("Last x2"), Some(2));
        assert_eq!(badge_in("Last"), None);
        let last = word("Last", 0.25, 0.193);
        assert!(last_equipped(&[&last], 0.337, 0.317));
        assert!(!last_equipped(&[&last], 0.525, 0.317));
    }

    #[test]
    fn a_badge_read_on_its_own() {
        assert_eq!(badge_from_text("x4"), Some(4));
        assert_eq!(badge_from_text("X 12"), Some(12));
        assert_eq!(badge_from_text("×2"), Some(2));
        assert_eq!(badge_from_text("x1"), None);
        assert_eq!(badge_from_text("Relic"), None);
    }

    #[test]
    fn relic_anchor_allows_one_ocr_error() {
        for word in ["Relic", "ReliC", "Rellc", "Rel1c", "Relic."] {
            assert!(is_relic_word(word), "{word}");
        }
        for word in ["Radiant", "Owned", "Select"] {
            assert!(!is_relic_word(word), "{word}");
        }
    }

    #[test]
    fn a_short_list_is_complete_even_when_ocr_misses_a_tile() {
        assert!(list_fits_on_screen(Some((8, 8))));
        assert!(!list_fits_on_screen(Some((8, 16))));
        assert!(!list_fits_on_screen(None));
    }
}
