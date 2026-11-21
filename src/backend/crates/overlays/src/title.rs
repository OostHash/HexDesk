//! Which screen a screen title read by OCR belongs to.
//!
//! The game spaces titles out letter by letter and OCR spacing varies, so only
//! the letters are compared. Thin letters are also misread now and then
//! ("FISSURf/REWAReDS"), so words of five letters or more may differ by one
//! letter.

use crate::screen::Screen;

/// The screen a title read from the top-left corner belongs to.
pub fn screen_from_title(title: &str) -> Option<Screen> {
    let letters = title_letters(title);
    if let Some(screen) = relic_list_screen(&letters) {
        return Some(screen);
    }
    let has = |word: &str| title_has(&letters, word);
    // The era line is only on relic lists. Without a readable title it cannot
    // prove refinement, so keep the EE.log-compatible selection fallback.
    if has("ERA") && has("COLLECTED") && has("RADIANT") {
        Some(Screen::RelicSelection)
    } else if has("FISSURE") && has("REWARD") {
        Some(Screen::RewardChoice)
    } else if has("INVENTORY") && has("MODS") {
        Some(Screen::Riven)
    } else {
        None
    }
}

/// Classifies only an explicit relic-list title. Unlike [`screen_from_title`],
/// the era counters alone do not guess that an unreadable title is selection.
pub fn relic_list_screen_from_title(title: &str) -> Option<Screen> {
    relic_list_screen(&title_letters(title))
}

fn title_letters(title: &str) -> Vec<u8> {
    title
        .bytes()
        .filter_map(|c| match c.to_ascii_uppercase() {
            b'0' => Some(b'O'),
            c if c.is_ascii_alphabetic() => Some(c),
            _ => None,
        })
        .collect()
}

fn title_has(letters: &[u8], word: &str) -> bool {
    let allowed = if word.len() >= 5 { 1 } else { 0 };
    contains_within(letters, word.as_bytes(), allowed)
}

fn relic_list_screen(letters: &[u8]) -> Option<Screen> {
    let has = |word: &str| title_has(letters, word);
    // "REFINE" rather than "REFINEMENT": OCR often garbles the word's end.
    if has("RELIC") && has("REFINE") {
        Some(Screen::RelicRefinement)
    } else if has("RELIC") && has("SELECT") {
        Some(Screen::RelicSelection)
    } else {
        None
    }
}

/// Whether `needle` occurs in `hay` with at most `edits` letters inserted,
/// removed or changed (approximate substring match, Sellers' algorithm).
fn contains_within(hay: &[u8], needle: &[u8], edits: usize) -> bool {
    if needle.is_empty() {
        return true;
    }
    // column[i]: fewest edits to match needle[..i] ending at the current
    // position in `hay`; a match may start anywhere, so row 0 stays 0.
    let mut column: Vec<usize> = (0..=needle.len()).collect();
    if column[needle.len()] <= edits {
        return true;
    }
    for &h in hay {
        let mut diagonal = column[0];
        for i in 1..=needle.len() {
            let above = column[i];
            let cost = usize::from(needle[i - 1] != h);
            column[i] = (diagonal + cost).min(above + 1).min(column[i - 1] + 1);
            diagonal = above;
        }
        if column[needle.len()] <= edits {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_map_to_their_screen() {
        assert_eq!(
            screen_from_title("VOID FISSURE/SELECT RELIC"),
            Some(Screen::RelicSelection)
        );
        assert_eq!(
            screen_from_title("VOID FISSURE/REWARDS"),
            Some(Screen::RewardChoice)
        );
        assert_eq!(screen_from_title("INVENTORY/MODS"), Some(Screen::Riven));
    }

    #[test]
    fn spaced_out_titles_with_ocr_slips_still_match() {
        assert_eq!(
            screen_from_title("V O I D  F I S S U R E / S E L E C T  R E L I C"),
            Some(Screen::RelicSelection)
        );
        assert_eq!(
            screen_from_title("V0ID FISSURE / REWARDS"),
            Some(Screen::RewardChoice)
        );
        assert_eq!(
            screen_from_title("I N V E N T 0 R Y / M O D S"),
            Some(Screen::Riven)
        );
    }

    #[test]
    fn one_misread_letter_in_a_long_word_still_matches() {
        // Text as OCR read it in the game.
        assert_eq!(
            screen_from_title("FISSURf/REWAReDS"),
            Some(Screen::RewardChoice)
        );
        assert_eq!(
            screen_from_title("01 D AXI ERA FISSURE [SELECT RELIC COLLECTED 4/5 RADIANT 0/5"),
            Some(Screen::RelicSelection)
        );
    }

    #[test]
    fn the_refinement_screen_is_a_relic_list() {
        // Text as OCR read it in the game, garbled end included.
        assert_eq!(
            screen_from_title("RELICS/REFINEMENT LITH ERA COLLECTED 9/202 RADIANT 1/202"),
            Some(Screen::RelicRefinement)
        );
        assert_eq!(
            screen_from_title("LITH ERA RELICS/REFINEMEIT COLLECTED 9/202 RADIANT 1/202"),
            Some(Screen::RelicRefinement)
        );
    }

    #[test]
    fn the_era_line_marks_a_relic_list_when_the_title_is_missed() {
        assert_eq!(
            screen_from_title("evil o NEO ERA ECOLLECTED 6/196 RADIANT 0/196"),
            Some(Screen::RelicSelection)
        );
        assert_eq!(
            relic_list_screen_from_title("evil o NEO ERA ECOLLECTED 6/196 RADIANT 0/196"),
            None
        );
    }

    #[test]
    fn explicit_relic_titles_can_be_classified_without_the_fallback() {
        assert_eq!(
            relic_list_screen_from_title("VOID FISSURE/SELECT RELIC"),
            Some(Screen::RelicSelection)
        );
        assert_eq!(
            relic_list_screen_from_title("RELICS/REFINEMEIT"),
            Some(Screen::RelicRefinement)
        );
    }

    #[test]
    fn half_a_title_or_another_screen_has_no_overlay() {
        assert_eq!(screen_from_title("FISSUR•E/"), None);
        assert_eq!(screen_from_title("INVENTORY/ARCANES"), None);
        assert_eq!(screen_from_title("INVENTORY/MOD"), None);
        assert_eq!(screen_from_title(""), None);
    }

    #[test]
    fn approximate_matching() {
        assert!(contains_within(b"XXFISSURFXX", b"FISSURE", 1));
        assert!(contains_within(b"REWAREDS", b"REWARD", 1));
        assert!(!contains_within(b"FISSUR", b"FISSURE", 0));
        assert!(!contains_within(b"FISS", b"FISSURE", 1));
    }
}
