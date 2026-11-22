//! The era of a relic list.

/// The fissure era in the text OCR read from the top-left of a relic list
/// ("AXI ERA COLLECTED 4/5 RADIANT 0/5"): "LITH", "MESO", "NEO", "AXI" or
/// "ALL". The full "<ERA> ERA" is preferred; the bare word counts when OCR
/// dropped "ERA".
pub fn era_from_text(text: &str) -> Option<&'static str> {
    const ERAS: [&str; 4] = ["LITH", "MESO", "NEO", "AXI"];
    let upper = text.to_uppercase();
    if let Some(era) = ERAS
        .iter()
        .find(|era| upper.contains(&format!("{era} ERA")))
    {
        return Some(era);
    }
    if upper.contains("ALL ERA") {
        return Some("ALL");
    }
    if let Some(era) = ERAS.iter().find(|era| upper.contains(*era)) {
        return Some(era);
    }
    upper.contains("ALL").then_some("ALL")
}

/// The era of a relic list, from the lines in its top fifth: the era line
/// and the title. Relic names further down name eras too ("Lith A1 Relic"
/// on the "ALL" list), so they are left out.
pub fn era_of_list(read: &hexdesk_capture::TextRead) -> Option<&'static str> {
    let head: Vec<&str> = read
        .lines
        .iter()
        .filter(|l| l.words.first().is_some_and(|w| w.top < 0.2))
        .map(|l| l.text.as_str())
        .collect();
    era_from_text(&head.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_era_line_names_the_era() {
        // Text as OCR read it in the game.
        assert_eq!(
            era_from_text("01 D AXI ERA FISSURE [SELECT RELIC COLLECTED 4/5 RADIANT 0/5"),
            Some("AXI")
        );
        assert_eq!(
            era_from_text("MESO ERA •COLLECTED 12/195 RADIANT 0/195"),
            Some("MESO")
        );
        assert_eq!(era_from_text("ALL ERAS COLLECTED"), Some("ALL"));
    }

    #[test]
    fn the_full_era_wins_over_a_bare_word() {
        // "NEO" is part of other words; "LITH ERA" is the era.
        assert_eq!(era_from_text("NEON LITH ERA"), Some("LITH"));
    }

    #[test]
    fn no_era_in_the_text() {
        assert_eq!(era_from_text("VOID FISSURE/REWARDS"), None);
        assert_eq!(era_from_text(""), None);
    }
}
