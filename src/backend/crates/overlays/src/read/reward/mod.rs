//! The reward cards on the fissure reward screen: which reward each card
//! shows, how sure the match is, and how many cards there should be.
//!
//! The screen shows one card per squad member, side by side, each with an
//! icon, the reward name under it (wrapped onto two lines when long), a
//! badge above it ("Owned", "12 Crafted") and a coloured rarity bar under
//! it with the player's name below the bar. Positions are fractions of the
//! reward area: the top 80 % of the game window.

mod confirm;
mod pixels;
mod words;

use std::collections::{HashMap, HashSet};

use hexdesk_capture::{Frame, TextRead};

pub use confirm::{Confirm, ShownCard, Verdict};
pub use pixels::IconType;

use pixels::{classify_card_icon, find_rarity_bars};
use words::{
    build_word_set, extract_item_name_words, lev_dist, normalise, score_item, word_found_in_set,
};

/// Words further apart than this belong to different cards. OCR can put two
/// adjacent reward names on one line; their bounding boxes are only about
/// 1.5 % apart, while words within one reward name are less than 0.5 % apart.
const CARD_GAP: f32 = 0.01;

/// Text above this is the screen title and the squad bar.
const TEXT_TOP: f32 = 0.10;

/// Text below this is under the rarity bars: player names, the hovered
/// card's description and the endless bonus line.
const TEXT_BOTTOM: f32 = 0.57;

/// A card matches a reward from this score up. A card whose text scores
/// lower is matched on its icon, which needs the same score.
const MATCH: f32 = 0.67;

/// The fill step only takes rewards whose name scores this well against all
/// the text on screen.
const FILL_MATCH: f32 = 0.80;

/// What the reader is given.
pub struct RewardInput<'a> {
    pub text: &'a TextRead,
    /// The picture OCR read, for the rarity bars and the card icons.
    pub frame: &'a Frame,
    /// The rewards a card can be: (path, name).
    pub catalog: &'a [(String, String)],
    /// The number of cards EE.log announced, when it did.
    pub squad_size: Option<usize>,
    /// Player names, which are never a reward name.
    pub player_names: &'a [String],
}

/// What the reward area showed.
#[derive(Debug, Clone, PartialEq)]
pub enum RewardScreen {
    /// OCR read no text: the frame is dark (a loading screen) or the cards
    /// are not drawn yet.
    NoText { dark: bool },
    /// A relic list (relic selection or refinement), not the reward screen.
    RelicList,
    /// Text that the reader went through, with the cards it found.
    Cards(RewardRead),
}

/// One read of the reward cards.
#[derive(Debug, Clone, PartialEq)]
pub struct RewardRead {
    /// The cards, left to right.
    pub cards: Vec<RewardCard>,
    /// How many cards the screen should show.
    pub expected: usize,
    /// What the expected count came from.
    pub expected_from: CardCount,
    /// How the text was split into cards.
    pub columns: Columns,
    /// What the rarity bar scan found.
    pub bars: String,
    /// Every piece of text OCR read, and why it was left out when it was.
    pub lines: Vec<ReadLine>,
}

/// Where the expected number of cards came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardCount {
    /// The squad size EE.log announced.
    EeLog,
    /// The rarity bars under the cards.
    Bars,
    /// Separate columns of text.
    Columns,
    /// The words "Prime" and "Forma" in the card names.
    Words,
}

impl CardCount {
    pub fn name(self) -> &'static str {
        match self {
            CardCount::EeLog => "EE.log",
            CardCount::Bars => "rarity bars",
            CardCount::Columns => "text columns",
            CardCount::Words => "prime and forma words",
        }
    }
}

/// How the text was split into cards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Columns {
    /// One column per rarity bar.
    Bars,
    /// One column per group of text: the bars were not found or did not
    /// fit the expected count.
    Text,
    /// Fixed positions for the expected count.
    Fixed,
}

impl Columns {
    pub fn name(self) -> &'static str {
        match self {
            Columns::Bars => "rarity bars",
            Columns::Text => "text columns",
            Columns::Fixed => "fixed positions",
        }
    }
}

/// A piece of text OCR read on the reward screen.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    /// Why the text is not part of a card name, when it is not.
    pub skipped: Option<&'static str>,
}

/// One reward card.
#[derive(Debug, Clone, PartialEq)]
pub struct RewardCard {
    /// The card's centre.
    pub x: f32,
    /// The text OCR read on the card; empty for a card the fill step added.
    pub text: String,
    /// The matched reward's path; None when nothing matched.
    pub item: Option<String>,
    /// The matched reward's name.
    pub name: Option<String>,
    pub score: f32,
    /// The next best rewards by text, with their scores.
    pub alternatives: Vec<(String, f32)>,
    pub matched_by: MatchedBy,
    /// Every word of the matched name was read on the card, or the icon
    /// confirmed it. A match from fewer words can be a sibling part
    /// ("Neuroptics" for "Chassis").
    pub sure: bool,
}

/// How a card was matched.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MatchedBy {
    /// Its name text.
    Text,
    /// Its name text was too poor; the icon's shape picked the part.
    Icon(IconType),
    /// No card column held it; it was found in all the text on screen.
    Fill,
    /// Nothing matched.
    None,
}

impl MatchedBy {
    pub fn name(self) -> &'static str {
        match self {
            MatchedBy::Text => "text",
            MatchedBy::Icon(_) => "icon",
            MatchedBy::Fill => "all text",
            MatchedBy::None => "nothing",
        }
    }
}

impl RewardRead {
    /// Cards that matched a reward.
    pub fn matched(&self) -> usize {
        self.cards.iter().filter(|c| c.item.is_some()).count()
    }

    /// Every expected card matched a reward.
    pub fn complete(&self) -> bool {
        let matched = self.matched();
        matched > 0 && matched >= self.expected
    }

    /// Every matched card is sure.
    pub fn sure(&self) -> bool {
        self.cards.iter().all(|c| c.item.is_none() || c.sure)
    }
}

/// Reads the reward cards.
pub fn read_reward_screen(input: &RewardInput<'_>) -> RewardScreen {
    let raw = input.text.text();
    if raw.trim().len() < 4 {
        return RewardScreen::NoText {
            dark: input.frame.brightness() < 30,
        };
    }
    if is_relic_list(&raw) {
        return RewardScreen::RelicList;
    }
    RewardScreen::Cards(read_cards(input))
}

/// A relic list names the refinement of several relics; the reward screen
/// names only the relic that was opened, once.
fn is_relic_list(raw: &str) -> bool {
    let lower = raw.to_lowercase();
    const REFINEMENTS: &[&str] = &["intact", "exceptional", "flawless", "radiant"];
    let hits: usize = REFINEMENTS.iter().map(|q| lower.matches(q).count()).sum();
    lower.contains(" relic") && hits >= 2
}

fn is_player_name(text: &str, names: &[String]) -> bool {
    let t = text.trim().to_lowercase();
    if t.is_empty() {
        return false;
    }
    names.iter().any(|name| {
        let n = name.to_lowercase();
        let threshold = (t.len().max(n.len()) / 5).max(1);
        t.contains(&n) || n.contains(&t) || lev_dist(&t, &n) <= threshold
    })
}

/// "Owned", "12 Crafted" and the like above a card.
fn is_badge(text: &str) -> bool {
    const BADGES: &[&str] = &["owned", "crafted", "unranked", "mastered"];
    let meaningful: Vec<&str> = text
        .split_whitespace()
        .filter(|w| {
            !w.starts_with('@')
                && w.parse::<u32>().is_err()
                && w.len() > 1
                && w.chars().any(|c| c.is_alphabetic())
        })
        .collect();
    !meaningful.is_empty()
        && meaningful
            .iter()
            .all(|w| BADGES.contains(&w.to_lowercase().as_str()))
}

fn is_prime_like(w: &str) -> bool {
    (w.starts_with("prim") && w.len() >= 4)
        || w == "pri"
        || ((3..=9).contains(&w.len()) && lev_dist(w, "prime") <= 1)
}

fn is_forma_like(w: &str) -> bool {
    w == "forma" || ((3..=7).contains(&w.len()) && lev_dist(w, "forma") <= 1)
}

/// The rarity bars of 2, 3 or 4 cards are evenly spaced around the middle;
/// bars that are not were found on something else.
fn bar_centers_are_valid(centers: &[f32]) -> bool {
    let n = centers.len();
    if n == 0 {
        return false;
    }
    if centers[0] < 0.15 || centers[n - 1] > 0.90 {
        return false;
    }
    if n < 2 {
        return true;
    }
    if centers.windows(2).any(|pair| pair[1] - pair[0] < 0.08) {
        return false;
    }
    if n >= 3 {
        let gaps: Vec<f32> = centers.windows(2).map(|p| p[1] - p[0]).collect();
        let mean = gaps.iter().sum::<f32>() / gaps.len() as f32;
        if gaps.iter().any(|g| (g - mean).abs() > 0.04) {
            return false;
        }
    }
    let span = centers[n - 1] - centers[0];
    let expected = match n {
        2 => 0.34f32,
        3 => 0.46,
        _ => 0.52,
    };
    (span - expected).abs() < 0.10
}

fn fixed_card_centers(n: usize) -> Vec<f32> {
    match n {
        1 => vec![0.50],
        2 => vec![0.435, 0.565],
        3 => vec![0.37, 0.50, 0.63],
        _ => vec![0.31, 0.44, 0.56, 0.69],
    }
}

/// Groups x-positions into clusters: a value joins the running cluster while
/// it stays within `gap` of that cluster's mean. Returns each cluster's
/// mean, left to right.
fn cluster_x_centers(mut xs: Vec<f32>, gap: f32) -> Vec<f32> {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut clusters: Vec<(f32, usize)> = Vec::new();
    for x in xs {
        match clusters.last_mut() {
            Some((sum, n)) if x - *sum / *n as f32 <= gap => {
                *sum += x;
                *n += 1;
            }
            _ => clusters.push((x, 1)),
        }
    }
    clusters
        .into_iter()
        .map(|(sum, n)| sum / n as f32)
        .collect()
}

/// The name of a catalogue path.
fn name_of<'a>(catalog: &'a [(String, String)], path: &str) -> Option<&'a str> {
    catalog
        .iter()
        .find(|(p, _)| p == path)
        .map(|(_, n)| n.as_str())
}

/// The distinct words of a name.
fn name_words(name: &str) -> Vec<String> {
    let norm = normalise(name);
    let mut seen = HashSet::new();
    norm.split_whitespace()
        .filter(|w| seen.insert(*w))
        .map(str::to_string)
        .collect()
}

fn read_cards(input: &RewardInput<'_>) -> RewardRead {
    let RewardInput {
        text,
        frame,
        catalog,
        squad_size,
        player_names,
    } = *input;

    let segments = text.segments(CARD_GAP);
    let lines: Vec<ReadLine> = segments
        .iter()
        .map(|(t, x, y)| {
            let tl = t.to_lowercase();
            let skipped = if *y < TEXT_TOP {
                Some("above the cards")
            } else if *y >= TEXT_BOTTOM {
                Some("below the rarity bars")
            } else if is_player_name(t, player_names) {
                Some("player name")
            } else if is_badge(t) {
                Some("card badge")
            } else if tl.contains("booster")
                || tl.contains("relic opened")
                || tl.contains("endless bonus")
            {
                Some("endless bonus")
            } else {
                None
            };
            ReadLine {
                text: t.trim().to_string(),
                x: *x,
                y: *y,
                skipped,
            }
        })
        .collect();

    // Name text: in the card band, not a player name or a badge. The endless
    // bonus text is listed as skipped above but sits below the bars anyway.
    let names: Vec<(&str, f32)> = segments
        .iter()
        .filter(|(t, _, y)| {
            t.trim().len() >= 3
                && *y >= TEXT_TOP
                && *y < TEXT_BOTTOM
                && !is_player_name(t, player_names)
                && !is_badge(t)
        })
        .map(|(t, x, _)| (t.as_str(), *x))
        .collect();

    let (bars, bar_scan) = find_rarity_bars(frame);
    let (bar_centers, bar_y) = bars.clone().unwrap_or_default();

    // Count "Prime" and "Forma" only in the name text: a hovered card's
    // description below the bars says them too, and counting those would
    // expect more cards than the screen has.
    let name_norm = normalise(&names.iter().map(|(t, _)| *t).collect::<Vec<_>>().join(" "));
    let prime_count = name_norm
        .split_whitespace()
        .filter(|w| is_prime_like(w))
        .count();
    let forma_count = name_norm
        .split_whitespace()
        .filter(|w| is_forma_like(w))
        .count();
    let text_columns = cluster_x_centers(names.iter().map(|(_, x)| *x).collect(), 0.10);
    let text_column_count = text_columns.len().min(4);
    let word_count = (prime_count + forma_count)
        .max(text_column_count)
        .max(squad_size.unwrap_or(0))
        .clamp(1, 4);

    let bars_trusted = !bar_centers.is_empty()
        && bar_centers.len() == word_count
        && bar_centers_are_valid(&bar_centers);
    // A wrapped name ("Dethcube Prime" over "Carapace") is one text column,
    // so it stays on one card.
    let (centers, columns) = if bars_trusted {
        (bar_centers.clone(), Columns::Bars)
    } else if !text_columns.is_empty() && text_columns.len() == word_count {
        (text_columns.clone(), Columns::Text)
    } else {
        (fixed_card_centers(word_count), Columns::Fixed)
    };

    let mut column_texts: Vec<Vec<String>> = vec![Vec::new(); centers.len()];
    for (t, x, y) in &segments {
        if *y < TEXT_TOP || *y >= TEXT_BOTTOM || is_player_name(t, player_names) || is_badge(t) {
            continue;
        }
        let nearest = centers
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                (x - *a)
                    .abs()
                    .partial_cmp(&(x - *b).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(0);
        column_texts[nearest].push(t.clone());
    }

    let mut cards: Vec<RewardCard> = Vec::new();
    for (texts, &cx) in column_texts.iter().zip(&centers) {
        let words = build_word_set(texts);
        if words.is_empty() {
            continue;
        }
        let card_text = texts
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let half_width = if centers.len() > 1 {
            0.56 / centers.len() as f32 / 2.0
        } else {
            0.10
        };
        cards.push(match_card(
            catalog,
            &words,
            card_text,
            cx,
            bars.as_ref().map(|_| (frame, half_width, bar_y)),
        ));
    }

    let (expected, expected_from) = {
        let from_bars = if bars_trusted { bar_centers.len() } else { 0 };
        let expected = squad_size
            .unwrap_or(0)
            .max(word_count)
            .max(from_bars)
            .max(1);
        let from = match squad_size {
            Some(h) if h >= word_count && h >= bar_centers.len() => CardCount::EeLog,
            _ if !bar_centers.is_empty() && bar_centers.len() >= word_count => CardCount::Bars,
            _ if text_column_count > prime_count + forma_count => CardCount::Columns,
            _ => CardCount::Words,
        };
        (expected, from)
    };

    let with_words = column_texts
        .iter()
        .filter(|t| !build_word_set(t).is_empty())
        .count();
    let fill_limit = expected.min(with_words);
    if cards.len() < fill_limit {
        fill(&mut cards, catalog, &segments, fill_limit, expected);
    }

    RewardRead {
        cards,
        expected,
        expected_from,
        columns,
        bars: bar_scan,
        lines,
    }
}

/// Matches one card's words against the catalogue, and its icon when the
/// text is too poor. `icon` is the frame, the card's half width and the
/// height of the rarity bars, when the bars were found.
fn match_card(
    catalog: &[(String, String)],
    words: &HashSet<String>,
    text: String,
    x: f32,
    icon: Option<(&Frame, f32, f32)>,
) -> RewardCard {
    let mut best_score = 0.0f32;
    let mut best_word_count = 0usize;
    let mut best: Option<&(String, String)> = None;
    let mut ranked: Vec<(f32, &str)> = Vec::new();
    for entry in catalog {
        let name = &entry.1;
        if name.len() < 5 {
            continue;
        }
        let score = score_item(name, words);
        let word_count = normalise(name).split_whitespace().count();
        // On a tie the longer name wins: "Lavos Prime Chassis Blueprint"
        // over "Lavos Prime Blueprint" when both read in full.
        if score > best_score || (score >= best_score - 1e-6 && word_count > best_word_count) {
            best_score = score;
            best_word_count = word_count;
            best = Some(entry);
        }
        if score > 0.0 {
            ranked.push((score, name));
        }
    }
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let best_name = best.map(|(_, n)| n.as_str());
    let alternatives: Vec<(String, f32)> = ranked
        .iter()
        .filter(|(_, n)| Some(*n) != best_name)
        .take(3)
        .map(|(s, n)| (n.to_string(), *s))
        .collect();

    let mut matched_by = MatchedBy::Text;
    if best_score < MATCH {
        if let Some((frame, half_width, bar_y)) = icon {
            let icon = classify_card_icon(
                frame,
                (x - half_width).max(0.0),
                (x + half_width).min(1.0),
                bar_y,
            );
            if let Some((entry, score)) = match_by_icon(catalog, words, icon) {
                best = Some(entry);
                best_score = score;
                matched_by = MatchedBy::Icon(icon);
            }
        }
    }

    match best {
        Some((path, name)) if best_score >= MATCH => {
            let sure = matches!(matched_by, MatchedBy::Icon(_))
                || name_words(name).iter().all(|w| word_found_in_set(w, words));
            RewardCard {
                x,
                text,
                item: Some(path.clone()),
                name: Some(name.clone()),
                score: best_score,
                alternatives,
                matched_by,
                sure,
            }
        }
        _ => RewardCard {
            x,
            text,
            item: None,
            name: None,
            score: best_score,
            alternatives,
            matched_by: MatchedBy::None,
            sure: false,
        },
    }
}

/// The reward whose name has the icon's part and the most of the read name
/// words, when it has at least [`MATCH`] of them.
fn match_by_icon<'a>(
    catalog: &'a [(String, String)],
    words: &HashSet<String>,
    icon: IconType,
) -> Option<(&'a (String, String), f32)> {
    let part = match icon {
        IconType::Component(part) => part,
        IconType::Forma => "forma",
        IconType::FullModel => "blueprint",
        IconType::Unknown => return None,
    };
    let part = normalise(part);
    let read = extract_item_name_words(words);
    let mut best: Option<(&(String, String), f32)> = None;
    for entry in catalog {
        if entry.1.len() < 5 {
            continue;
        }
        let name = normalise(&entry.1);
        if !name.contains(part.as_str()) {
            continue;
        }
        let score = if read.is_empty() {
            0.5
        } else {
            read.iter().filter(|w| name.contains(w.as_str())).count() as f32 / read.len() as f32
        };
        if best.is_none_or(|(_, s)| score > s) {
            best = Some((entry, score));
        }
    }
    best.filter(|(_, score)| *score >= MATCH)
}

/// Adds rewards found in all the name text when the columns gave fewer cards
/// than expected: a name OCR split over two columns, or a column that held
/// no name. Rewards are taken in the order their words appear on screen,
/// and a reward or a sibling part of one already shown is skipped unless
/// the columns showed it twice. The cards are then spaced evenly, since
/// their columns are no longer known.
fn fill(
    cards: &mut Vec<RewardCard>,
    catalog: &[(String, String)],
    segments: &[(String, f32, f32)],
    limit: usize,
    expected: usize,
) {
    let all_words = build_word_set(
        &segments
            .iter()
            .filter(|(_, _, y)| *y >= TEXT_TOP && *y < TEXT_BOTTOM)
            .map(|(t, _, _)| t.clone())
            .collect::<Vec<_>>(),
    );
    const GENERIC: &[&str] = &["prime", "owned", "crafted", "blueprint"];

    let mut candidates: Vec<(usize, f32, usize, &str)> = Vec::new();
    for (path, name) in catalog {
        if name.len() < 5 {
            continue;
        }
        let score = score_item(name, &all_words);
        if score < FILL_MATCH {
            continue;
        }
        let norm = normalise(name);
        let key_words: Vec<&str> = norm
            .split_whitespace()
            .filter(|w| w.len() >= 4 && !GENERIC.contains(w))
            .collect();
        let first_line = if key_words.is_empty() {
            500usize
        } else {
            segments
                .iter()
                .position(|(t, _, _)| {
                    let t = normalise(t);
                    key_words.iter().any(|&w| t.contains(w))
                })
                .unwrap_or(999)
        };
        candidates.push((first_line, score, name.len(), path));
    }
    candidates.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal))
            .then(b.2.cmp(&a.2))
    });

    let mut seen_bases: HashSet<String> = HashSet::new();
    let mut column_counts: HashMap<String, usize> = HashMap::new();
    for card in cards.iter() {
        let Some(path) = &card.item else { continue };
        *column_counts.entry(path.clone()).or_insert(0) += 1;
        if let Some(base) = name_of(catalog, path).and_then(base_of) {
            seen_bases.insert(base);
        }
    }

    for (_, score, _, path) in candidates {
        if cards.len() >= limit {
            break;
        }
        let Some(name) = name_of(catalog, path) else {
            continue;
        };
        let shown = cards
            .iter()
            .filter(|c| c.item.as_deref() == Some(path))
            .count();
        if shown > 0 {
            let in_columns = column_counts.get(path).copied().unwrap_or(0);
            if in_columns < 2 || shown >= in_columns {
                continue;
            }
        } else if let Some(base) = base_of(name) {
            if !seen_bases.insert(base) {
                continue;
            }
        }
        let sure = name_words(name)
            .iter()
            .all(|w| word_found_in_set(w, &all_words));
        cards.push(RewardCard {
            x: 0.0,
            text: String::new(),
            item: Some(path.to_string()),
            name: Some(name.to_string()),
            score,
            alternatives: Vec::new(),
            matched_by: MatchedBy::Fill,
            sure,
        });
    }

    if !cards.is_empty() {
        let n = expected.max(cards.len());
        let spacing = 0.70 / (n as f32 + 1.0);
        for (i, card) in cards.iter_mut().enumerate() {
            card.x = 0.15 + spacing * (i as f32 + 1.0);
        }
    }
}

/// A name without its last word ("Lex Prime" for "Lex Prime Barrel"), for
/// names of two words or more.
fn base_of(name: &str) -> Option<String> {
    let norm = normalise(name);
    let words: Vec<&str> = norm.split_whitespace().collect();
    (words.len() >= 2).then(|| words[..words.len() - 1].join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use hexdesk_capture::{Line, Word};

    fn ocr_words(words: &[&str]) -> HashSet<String> {
        words.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn four_character_words_must_be_read_exactly() {
        for (catalog_word, on_screen) in [
            ("limb", "limbo"),
            ("gara", "galatine"),
            ("khra", "khora"),
            ("star", "stars"),
        ] {
            assert!(
                !word_found_in_set(catalog_word, &ocr_words(&[on_screen])),
                "{catalog_word:?} must not match {on_screen:?}"
            );
        }
    }

    #[test]
    fn longer_words_keep_their_edit_tolerance() {
        assert!(word_found_in_set("blueprint", &ocr_words(&["bluepnnt"])));
        assert!(word_found_in_set("tenora", &ocr_words(&["tenova"])));
        assert!(word_found_in_set("limb", &ocr_words(&["lim"])));
    }

    #[test]
    fn bar_centers_must_be_evenly_spaced() {
        assert!(!bar_centers_are_valid(&[0.204, 0.316, 0.655]));
        assert!(bar_centers_are_valid(&[0.27, 0.50, 0.73]));
        assert!(bar_centers_are_valid(&[0.24, 0.41, 0.59, 0.76]));
    }

    /// A read with one word per piece of text, centred on (x, y).
    fn text_read(lines: &[(&str, f32, f32)]) -> TextRead {
        TextRead {
            engine: "test".into(),
            width: 1000,
            height: 500,
            lines: lines
                .iter()
                .map(|(t, x, y)| Line {
                    text: t.to_string(),
                    words: vec![Word {
                        text: t.to_string(),
                        left: x - 0.01,
                        top: y - 0.01,
                        width: 0.02,
                        height: 0.02,
                    }],
                })
                .collect(),
        }
    }

    fn catalog(names: &[&str]) -> Vec<(String, String)> {
        names
            .iter()
            .map(|n| (n.to_string(), n.to_string()))
            .collect()
    }

    fn word(text: &str, left: f32, width: f32) -> Word {
        Word {
            text: text.to_string(),
            left,
            top: 0.39,
            width,
            height: 0.02,
        }
    }

    fn line(text: &str, words: Vec<Word>) -> Line {
        Line {
            text: text.to_string(),
            words,
        }
    }

    #[test]
    fn four_close_reward_cards_stay_in_four_columns() {
        let text = TextRead {
            engine: "test".into(),
            width: 1920,
            height: 1080,
            lines: vec![
                line(
                    "Quassus Prime Blueprint",
                    vec![
                        word("Quassus", 0.254, 0.039),
                        word("Prime", 0.297, 0.027),
                        word("Blueprint", 0.327, 0.041),
                    ],
                ),
                line("Citrine Prime", vec![word("Citrine Prime", 0.388, 0.030)]),
                line("Chassis", vec![word("Chassis", 0.463, 0.023)]),
                line("Blueprint", vec![word("Blueprint", 0.416, 0.041)]),
                line(
                    "Steflos Prime Blueprint Daikyu Prime Upper Limb",
                    vec![
                        word("Steflos", 0.510, 0.032),
                        word("Prime", 0.545, 0.026),
                        word("Blueprint", 0.575, 0.041),
                        word("Daikyu", 0.631, 0.030),
                        word("Prime", 0.665, 0.027),
                        word("Upper", 0.695, 0.027),
                        word("Limb", 0.726, 0.022),
                    ],
                ),
            ],
        };
        let catalog = catalog(&[
            "Quassus Prime Blueprint",
            "Citrine Prime Chassis Blueprint",
            "Steflos Prime Blueprint",
            "Daikyu Prime Upper Limb",
        ]);
        let frame = Frame::new(vec![0u8; 8 * 8 * 4], 8, 8);
        let read = read_cards(&RewardInput {
            text: &text,
            frame: &frame,
            catalog: &catalog,
            squad_size: Some(4),
            player_names: &[],
        });

        assert_eq!(read.expected, 4);
        assert_eq!(read.columns, Columns::Fixed);
        let names: Vec<&str> = read
            .cards
            .iter()
            .filter_map(|card| card.name.as_deref())
            .collect();
        assert_eq!(
            names,
            [
                "Quassus Prime Blueprint",
                "Citrine Prime Chassis Blueprint",
                "Steflos Prime Blueprint",
                "Daikyu Prime Upper Limb",
            ]
        );
    }

    #[test]
    fn a_hovered_card_tooltip_does_not_fabricate_a_fourth_reward() {
        let text = text_read(&[
            ("0", 0.05, 0.01),
            ("99%", 0.09, 0.01),
            ("C", 0.11, 0.01),
            ("15%", 0.15, 0.01),
            ("53\"", 0.16, 0.01),
            ("——— = VOID FISSURE/REWARDS", 0.19, 0.08),
            ("3", 0.50, 0.19),
            ("& Crafted", 0.59, 0.28),
            ("® Owned", 0.34, 0.28),
            ("® Owned", 0.46, 0.28),
            ("Lavos Prime Chassis", 0.50, 0.49),
            ("Lex Prime Barrel", 0.37, 0.52),
            ("Blueprint", 0.50, 0.52),
            ("2 X Forma Blueprint", 0.61, 0.52),
            ("LEX PRIME BARREL", 0.32, 0.57),
            ("teOwl12 5a", 0.52, 0.59),
            ("Falcon1719+", 0.62, 0.59),
            ("N", 0.47, 0.64),
            ("©@ 1 Owned", 0.30, 0.63),
            ("A prime weapon-crafting component.", 0.34, 0.70),
            ("Can be exchanged for", 0.33, 0.76),
            ("15 Ducats", 0.43, 0.76),
            ("Steel Path Bonus", 0.53, 0.77),
            ("+1 Steel Essence", 0.53, 0.80),
            (
                "Endless Bonus Affinity Booster | 1 Relic Opened",
                0.51,
                0.89,
            ),
        ]);
        let catalog = catalog(&[
            "Lex Prime Barrel",
            "Lex Prime Blueprint",
            "Lex Prime Receiver",
            "Lavos Prime Blueprint",
            "Lavos Prime Chassis Blueprint",
            "Lavos Prime Neuroptics Blueprint",
            "Lavos Prime Systems Blueprint",
            "Forma Blueprint",
            "2X Forma Blueprint",
            "Trinity Prime Blueprint",
            "Trinity Prime Chassis Blueprint",
            "Trinity Prime Neuroptics Blueprint",
            "Trinity Prime Systems Blueprint",
            "Atlas Prime Chassis Blueprint",
            "Acceltra Prime Barrel",
            "Afuris Prime Barrel",
            "Boltor Prime Barrel",
        ]);
        let players: Vec<String> = ["Vireo_", "q-lox", "Falcon1719", "PrivateOwl12"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let frame = Frame::new(vec![0u8; 8 * 8 * 4], 8, 8);
        let RewardScreen::Cards(read) = read_reward_screen(&RewardInput {
            text: &text,
            frame: &frame,
            catalog: &catalog,
            squad_size: None,
            player_names: &players,
        }) else {
            panic!("no cards read");
        };
        let mut got: Vec<String> = read
            .cards
            .iter()
            .filter_map(|c| c.name.clone())
            .map(|n| n.trim_start_matches("2X ").to_string())
            .collect();
        got.sort();
        assert_eq!(
            got,
            [
                "Forma Blueprint",
                "Lavos Prime Chassis Blueprint",
                "Lex Prime Barrel"
            ],
            "{read:#?}"
        );
    }

    #[test]
    fn a_relic_list_is_not_read_as_rewards() {
        let text = text_read(&[
            ("VOID FISSURE/SELECT RELIC", 0.2, 0.05),
            ("Meso V13 Relic", 0.2, 0.3),
            ("[Exceptional]", 0.2, 0.33),
            ("Meso D8 Relic", 0.4, 0.3),
            ("[Radiant]", 0.4, 0.33),
        ]);
        let frame = Frame::new(vec![0u8; 8 * 8 * 4], 8, 8);
        let screen = read_reward_screen(&RewardInput {
            text: &text,
            frame: &frame,
            catalog: &[],
            squad_size: None,
            player_names: &[],
        });
        assert_eq!(screen, RewardScreen::RelicList);
    }

    #[test]
    fn no_text_on_a_dark_frame() {
        let text = text_read(&[]);
        let frame = Frame::new(vec![0u8; 8 * 8 * 4], 8, 8);
        let screen = read_reward_screen(&RewardInput {
            text: &text,
            frame: &frame,
            catalog: &[],
            squad_size: None,
            player_names: &[],
        });
        assert_eq!(screen, RewardScreen::NoText { dark: true });
    }
}
