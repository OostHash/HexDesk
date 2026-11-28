//! The riven card on the mods and reroll screens: the weapon it fits and the
//! stats it rolled, from what OCR read in the parts of the screen the app
//! captures. On the reroll comparison screen two cards show: the roll before
//! the reroll on the left, the new roll on the right.

/// One rolled stat: its full name, the value as shown ("+47.2%", "x1.29")
/// and whether it is a positive.
#[derive(Debug, Clone, PartialEq)]
pub struct RivenStat {
    pub name: String,
    pub value: String,
    pub positive: bool,
}

/// What OCR read in the parts of the riven screen.
pub struct RivenTexts<'a> {
    /// The card column.
    pub card: &'a str,
    /// The whole width, used when the card column held no stats.
    pub full: &'a str,
    /// The "FITS IN" panel on the right.
    pub panel: &'a str,
    /// On the comparison screen, the left card (before the reroll).
    pub left: &'a str,
    /// On the comparison screen, the right card (the new roll).
    pub right: &'a str,
}

/// The card that was read.
#[derive(Debug, Clone, PartialEq)]
pub struct RivenCard {
    /// The weapon in lower case, as the riven database names it; empty when
    /// none was read.
    pub weapon: String,
    pub positives: Vec<String>,
    pub negatives: Vec<String>,
    pub rolled_stats: Vec<RivenStat>,
    pub is_comparison: bool,
    /// The stats before the reroll, on the comparison screen.
    pub original_stats: Vec<RivenStat>,
    /// The card text OCR read.
    pub raw: String,
}

/// Lines that start a stat: a sign in front.
pub fn stat_lines(text: &str) -> usize {
    text.lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with('+') || t.starts_with('-')
        })
        .count()
}

/// More than four stat lines means two cards: a riven has at most four
/// stats (three positives and a negative).
pub fn is_comparison(card: &str) -> bool {
    stat_lines(card) > 4
}

/// Reads the card. `known` says whether the riven database knows a weapon
/// name (lower case).
pub fn read_riven_card(texts: &RivenTexts<'_>, known: &dyn Fn(&str) -> bool) -> RivenCard {
    let text = texts.card;
    let full_text_for_fallback = texts.full;
    let panel_for_weapon = texts.panel;
    let (left_text, right_text) = (texts.left, texts.right);
    let is_comparison = is_comparison(text);

    // Which text to parse for the new roll:
    // - Comparison mode: right column = new roll, left column = original
    // - Single card mode: card column text; fall back to full text if card column had no stats
    let card_has_stats = text.lines().any(|l| {
        let t = l.trim();
        t.starts_with('+') || t.starts_with('-')
    });
    let parse_text = if is_comparison && !right_text.is_empty() {
        &right_text
    } else if !card_has_stats && !full_text_for_fallback.is_empty() {
        // Card column empty — fall back to the full-width validated text
        &full_text_for_fallback
    } else {
        &text
    };
    let original_parse_text = if is_comparison && !left_text.is_empty() {
        Some(left_text)
    } else {
        None
    };

    // Parse weapon name.
    // In the unveil screen "FITS IN" appears on its own line, weapon name on the next line.
    // In the reroll screen the mod name is "WeaponName RivenIdentifier" (e.g. "Hirudo Geli-plecinus").
    let lines: Vec<&str> = parse_text.lines().collect();

    // Helper: try to match a candidate string against the riven database, trying word-prefix
    // substrings from longest to shortest (handles "Dual Cleavers Cronitron" → "dual cleavers").
    let find_in_db = |candidate: &str| -> Option<String> {
        let words: Vec<&str> = candidate.split_whitespace().collect();
        // Try 4-word prefix, then 3, 2, 1
        for len in (1..=words.len().min(4)).rev() {
            let prefix = words[..len].join(" ");
            if known(&prefix) {
                return Some(prefix);
            }
        }
        None
    };

    // The "FITS IN" panel is the only place the game states the weapon outright,
    // and it states the real one: a Kuva Nukor riven is titled "Nukor Crita-
    // hexapha" above the card, which resolves to the ordinary Nukor and its
    // different disposition.
    //
    // The grading sheet is a curated list, not a weapon index. It carries
    // "kuva bramma" but not "kuva nukor", so a panel name it does not know is
    // still the right answer. Reporting it unmatched costs the roll analysis
    // (there is none for a weapon the database does not know, and the
    // overlay shows that) and buys not silently grading a Kuva Nukor as the base
    // Nukor it is titled after, on a different disposition.
    let panel_candidates = panel_weapon_candidates(panel_for_weapon);
    let weapon = panel_candidates.iter()
        .find_map(|l| find_in_db(l))
        .or_else(|| panel_candidates.last().cloned())
        .or_else(|| lines.iter().enumerate()
            .find(|(_, l)| says_fits_in(&l.to_lowercase()))
            .and_then(|(i, _)| lines.get(i + 1))
            .and_then(|l| {
                let lc = l.trim().to_lowercase();
                find_in_db(&lc).or(Some(lc))
            }))
        // Fallback: first non-stat, non-UI line is the mod name "WeaponName RivenId".
        // Only accept if it matches a weapon in the DB — avoids returning currency values
        // like "D '5,598" (Endo count) that pass the basic filter.
        .or_else(|| {
            lines.iter()
                .find_map(|l| {
                    let lt = l.trim().to_lowercase();
                    if lt.is_empty() { return None; }
                    // Skip UI noise. "kuva" is deliberately absent: it prefixes a
                    // whole weapon family, so skipping it lost the name of every
                    // Kuva riven. "Remaining Kuva 102,773" is already caught by
                    // "remaining" and the currency-value rules below.
                    if lt.contains("fits in") || lt.contains("cycle")
                    || lt.contains("mr ") || lt.contains("inventory") || lt.contains("mods")
                    || lt.contains("remaining") || lt.contains("show ranked") || lt.contains("cancel")
                    || lt.starts_with('+') || lt.starts_with('-') || lt.starts_with('x')
                    || lt.chars().next().is_some_and(|c| c.is_ascii_digit())
                    // Skip lines that look like currency values (contain digit+comma or digit+apostrophe)
                    || (lt.contains(',') && lt.chars().any(|c| c.is_ascii_digit()))
                    || (lt.contains('\'') && lt.chars().any(|c| c.is_ascii_digit()))
                    {
                        return None;
                    }
                    find_in_db(&lt) // only return if it's actually in the DB
                })
        })
        .unwrap_or_default();

    let joined = join_wrapped_stat_lines(parse_text);

    // Parse stat lines and collect rolled_stats (name + formatted value for display).
    let mut positives: Vec<String> = Vec::new();
    let mut negatives: Vec<String> = Vec::new();
    // Each entry: { "name": "Combo Count Chance", "value": "+47.2%", "positive": true }
    let mut rolled_stats: Vec<RivenStat> = Vec::new();

    for line in &joined {
        let l = line.trim();

        // Handle multiplier format "x1.62 Damage to Corpus"
        // OCR may insert spaces inside the number ("x1 .62"), so collect everything
        // before the first alphabetic char and join to remove those spaces.
        if l.to_lowercase().starts_with('x')
            && l.len() > 2
            && l.chars()
                .nth(1)
                .is_some_and(|c| c.is_ascii_digit() || c == ' ')
        {
            let alpha_start = l
                .find(|c: char| c.is_alphabetic() && c != 'x')
                .unwrap_or(l.len());
            let val_str = l[..alpha_start]
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(""); // e.g. "x1.62"
            let stat_name = l[alpha_start..].trim();
            let stat_name = stat_name.split(" (").next().unwrap_or(stat_name).trim();
            if !stat_name.is_empty() {
                let full = ocr_stat_to_full_with_condition(stat_name);
                rolled_stats.push(RivenStat {
                    name: full.clone(),
                    value: val_str,
                    positive: true,
                });
                positives.push(full);
            }
            continue;
        }

        let first_l = l.chars().next().unwrap_or(' ');
        let (is_pos, stat_part) = if l.starts_with('+') {
            (true, l.trim_start_matches('+'))
        } else if l.starts_with('-') {
            (false, l.trim_start_matches('-'))
        } else if "•·○●◦".contains(first_l) {
            // OCR misread '+' as a bullet/dot character — treat as positive stat
            (true, l.trim_start_matches(|c: char| "•·○●◦".contains(c)))
        } else {
            continue;
        };

        // Extract the numeric value string.
        // Must explicitly check for '%' first — split('%').next() returns Some(whole_string)
        // even when no '%' is present, which would produce "+51 'Toxin%" for element stats.
        let pct_val = if stat_part.starts_with("?%") {
            // Synthesised from orphan stat — OCR dropped the x-multiplier value
            "x?".to_string()
        } else if stat_part.contains('%') {
            let n = stat_part.split('%').next().unwrap_or("").trim();
            format!("{}{}%", if is_pos { "+" } else { "-" }, n)
        } else {
            // No % sign (element stats, OCR dropped it) — extract leading digits only
            let num_end = stat_part
                .find(|c: char| !c.is_ascii_digit() && c != '.')
                .unwrap_or(stat_part.len());
            format!(
                "{}{}%",
                if is_pos { "+" } else { "-" },
                &stat_part[..num_end]
            )
        };

        // Extract stat name
        let stat_name: &str = if let Some(after_pct) = stat_part.split_once('%').map(|x| x.1) {
            after_pct.trim()
        } else {
            let num_end = stat_part.find(|c: char| c.is_alphabetic()).unwrap_or(0);
            stat_part[num_end..].trim_start_matches(|c: char| !c.is_alphabetic())
        };
        if stat_name.is_empty() {
            continue;
        }

        // Strip leading OCR icon artifacts: "61-leat" → "leat", " 🔥Heat" → "Heat"
        let stat_name = stat_name.trim_start_matches(|c: char| !c.is_alphabetic());
        if stat_name.is_empty() {
            continue;
        }

        // Strip parenthetical qualifiers: "Critical Chance (x2 for Heavy Attacks)" → "Critical Chance"
        let stat_name = stat_name.split(" (").next().unwrap_or(stat_name).trim();

        // Try to match with the full conditional name first so "Critical Chance for Slide Attack"
        // maps to "Slide Critical Chance" (not just "Critical Chance"). Fall back to stripped form.
        let full = ocr_stat_to_full_with_condition(stat_name);
        rolled_stats.push(RivenStat {
            name: full.clone(),
            value: pct_val,
            positive: is_pos,
        });
        if is_pos {
            positives.push(full);
        } else {
            negatives.push(full);
        }
    }

    RivenCard {
        weapon,
        positives,
        negatives,
        rolled_stats,
        is_comparison,
        original_stats: parse_original_stats(original_parse_text),
        raw: text.to_string(),
    }
}

/// Whether `text` (already lowercased) carries the riven screen's "FITS IN"
/// panel label. The label is small enough on a 4K frame that an engine can close
/// the word gap and report "FITSIN", so both sides are compared with spaces
/// removed.
pub fn says_fits_in(text: &str) -> bool {
    text.replace(' ', "").contains("fitsin")
}

/// Weapon-name candidates from the "FITS IN" panel's OCR, top to bottom.
///
/// The panel is mostly icon and border debris (single glyphs, punctuation)
/// with the weapon name and the panel's own buttons as the only real words, so a
/// candidate is a line of at least four letters that is not one of those
/// buttons. The name sits below the "FITS IN" label and above "SHOW RANKED",
/// which is why callers take the last candidate rather than the first.
fn panel_weapon_candidates(panel: &str) -> Vec<String> {
    panel
        .lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| {
            l.chars().filter(|c| c.is_alphabetic()).count() >= 4
                && !says_fits_in(l)
                && !l.contains("show ranked")
                && !l.contains("close")
                && !l.contains("cancel")
        })
        .collect()
}

/// Rejoin a riven card's OCR text into one line per stat.
///
/// A stat starts with `+<digit>`, `-<digit>` or `x<digit>`; the digit matters
/// because the card's dividers arrive as bare signs. Long names wrap onto a
/// second line ("+22.2% Magazine" / "Capacity"), so a following line is normally
/// the tail of the stat above it.
///
/// The border, rank pips and element icons also arrive as short punctuation
/// (`_`, `;`, `==`, `¢ Y`). Gluing those into a name breaks the lookup
/// ("Magazine _ Capacity"), so a continuation has to read as a word: three or
/// more letters, which also excludes the "MR11" rank label. Trailing debris is
/// left alone, since the lookup matches on substrings.
fn join_wrapped_stat_lines(text: &str) -> Vec<String> {
    let mut joined: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;
    for line in text.lines() {
        // Artwork bleed puts stray glyphs in front of a sign ("v & -34.3%
        // Critical Chance"), hiding it so the stat joins upward and two are lost.
        // Trim only a short prefix carrying no word of its own: "Re-1oad Speed"
        // is a wrapped name, and "MR-1" would become a stat the card never had.
        // Counted in chars, not bytes, since this is where multi-byte glyphs land.
        let l = line.trim();
        let l = match l.find(['+', '-', 'x', 'X']) {
            Some(at)
                if at > 0
                    && l[..at].chars().count() <= 4
                    && !l[..at].ends_with(|c: char| c.is_alphanumeric())
                    && l[at + 1..].starts_with(|c: char| c.is_ascii_digit())
                    && l[..at].chars().filter(|c| c.is_alphabetic()).count() <= 2 =>
            {
                &l[at..]
            }
            _ => l,
        };
        if l.is_empty() {
            continue;
        }
        let ll = l.to_lowercase();
        // OCR sometimes misreads '+' as '•', '·', or similar bullet chars
        let first_char = l.chars().next().unwrap_or(' ');
        let is_ocr_plus = "•·○●◦".contains(first_char)
            && l.len() > 1
            && l.chars().nth(1).is_some_and(|c| c.is_ascii_digit());
        // A sign alone is not a stat: dividers come through as bare "-" lines,
        // which invented a negative stat on every card. Require a digit behind it.
        let is_signed_value = (l.starts_with('+') || l.starts_with('-'))
            && l[1..]
                .trim_start()
                .starts_with(|c: char| c.is_ascii_digit());
        let is_stat_start = is_signed_value
            || (ll.starts_with('x')
                && l.len() > 2
                && l.chars().nth(1).is_some_and(|c| c.is_ascii_digit()))
            || is_ocr_plus;
        // "Damage to Grineer/Corpus/Infested" arrives unprefixed when the OCR
        // drops the leading "x0.88" multiplier.
        let is_orphan_stat = ll.starts_with("damage to grineer")
            || ll.starts_with("damage to corpus")
            || ll.starts_with("damage to infested");
        // "kuva" comes off the weapon-name filter below but stays here: a reroll
        // comparison screen stacks two cards, so the lower card's title follows
        // the upper card's stats with nothing between, and a title reads as a word.
        // Only Kuva titles are caught: "Boltor Conci-" still glues, which would
        // need a title recognised as a title rather than another word on a list.
        let is_ui_noise = ll.contains("fits in")
            || ll.starts_with("mr ")
            || ll.contains("inventory")
            || ll.contains("cycle")
            || ll.contains("kuva")
            || ll.contains("remaining")
            || ll.contains("show ranked")
            || ll.contains("cancel");
        let reads_as_a_word = l.chars().filter(|c| c.is_alphabetic()).count() >= 3;
        if is_stat_start {
            if let Some(prev) = pending.take() {
                joined.push(prev);
            }
            pending = Some(l.to_string());
        } else if is_orphan_stat {
            if let Some(prev) = pending.take() {
                joined.push(prev);
            }
            joined.push(format!("+?% {}", l));
        } else if is_ui_noise {
            if let Some(prev) = pending.take() {
                joined.push(prev);
            }
        } else if reads_as_a_word {
            if let Some(ref mut prev) = pending {
                prev.push(' ');
                prev.push_str(l);
            }
        }
    }
    if let Some(prev) = pending {
        joined.push(prev);
    }
    joined
}

/// Like ocr_stat_to_full but first tries the full conditional name, then strips "for X" and retries.
/// "Critical Chance for Slide Attack" → "Slide Critical Chance" (full wins)
/// "Critical Damage for Slide Attack" → stripped → "Critical Damage" (full doesn't match, fallback)
fn ocr_stat_to_full_with_condition(ocr_name: &str) -> String {
    let full_try = ocr_stat_to_full(ocr_name);
    if full_try != ocr_name {
        return full_try; // matched on full name
    }
    // Strip "for <condition>" and try again
    let stripped = ocr_name.split(" for ").next().unwrap_or(ocr_name).trim();
    if stripped != ocr_name {
        let stripped_try = ocr_stat_to_full(stripped);
        if stripped_try != stripped {
            return stripped_try;
        }
    }
    full_try // return best effort even if unrecognized
}

/// In-game stat names → database full names (handles abbreviations and element icons stripped by OCR)
fn ocr_stat_to_full(ocr_name: &str) -> String {
    // Strip leading OCR artifacts from element icons (e.g. "61-leat" → "leat" from 🔥Heat,
    // "ld" from ❄Cold, etc.) before pattern matching.
    let stripped = ocr_name
        .trim()
        .trim_start_matches(|c: char| !c.is_alphabetic());
    let n = stripped.to_lowercase();
    match n.as_str() {
        // Conditional melee stats — checked FIRST so "critical chance for slide attack" wins
        // over the generic "critical chance" pattern below
        s if s.contains("critical chance")
            && (s.contains("slide") || s.contains("slide attack")) =>
        {
            "Slide Critical Chance"
        }
        s if s.contains("critical chance") && s.contains("aerial") => "Aerial Critical Chance",
        s if s.contains("critical chance") && s.contains("wall") => "Wall Critical Chance",
        s if s.contains("critical damage")
            || s.contains("crit. damage")
            || s.contains("crit damage") =>
        {
            "Critical Damage"
        }
        s if s.contains("critical chance")
            || s.contains("crit. chance")
            || s.contains("crit chance") =>
        {
            "Critical Chance"
        }
        s if s.contains("multishot") => "Multishot",
        s if s.contains("fire rate") => "Fire Rate",
        s if s.contains("status chance") => "Status Chance",
        s if s.contains("base damage")
            || (s.contains("damage")
                && !s.contains("critical")
                && !s.contains("infested")
                && !s.contains("grineer")
                && !s.contains("corpus")) =>
        {
            "Base Damage"
        }
        // Toxin — icon may eat 'T', leaving "oxin" or "oxicity"
        s if s.contains("toxin") || s.contains("toxicity") || s.starts_with("oxin") => "Toxicity",
        // Heat — fire icon may eat 'H', leaving "eat" or "leat"
        s if s.contains("heat")
            || s.contains("fire damage")
            || s == "eat"
            || s == "leat"
            || (s.ends_with("eat") && s.len() <= 7) =>
        {
            "Heat"
        }
        // Electricity — icon may eat 'E', leaving "lectricity" etc.
        s if s.contains("electricity") || s.contains("electric") || s.starts_with("lectr") => {
            "Electricity"
        }
        // Cold — ice icon may eat 'C', leaving "old"
        s if s.contains("cold") || s.contains("freeze") || s == "old" => "Cold",
        s if s.contains("punch through") => "Punch Through",
        s if s.contains("reload speed") || s.contains("reload") => "Reload Speed",
        s if s.contains("magazine size") || s.contains("magazine") || s.contains("mag size") => {
            "Magazine Size"
        }
        s if s.contains("ammo max") || s.contains("ammo maximum") => "Ammo Maximum",
        s if s.contains("zoom") => "Zoom",
        s if s.contains("recoil") => "Recoil",
        s if s.contains("slash") => "Slash",
        s if s.contains("puncture") => "Puncture",
        s if s.contains("impact") => "Impact",
        s if s.contains("flight speed")
            || s.contains("proj. flight")
            || s.contains("projectile") =>
        {
            "Projectile Flight Speed"
        }
        s if s.contains("status duration") => "Status Duration",
        s if s.contains("infested") => "Damage to Infested",
        s if s.contains("grineer") => "Damage to Grineer",
        s if s.contains("corpus") => "Damage to Corpus",
        // Melee-specific stats
        s if s.contains("attack speed") || s.contains("attack spd") => "Attack Speed",
        s if s.contains("combo duration") => "Combo Duration",
        s if s.contains("combo count") => "Combo Count Chance",
        s if s.contains("heavy attack") && s.contains("efficiency") => "Heavy Attack Efficiency",
        s if s.contains("heavy attack") => "Heavy Attack Damage",
        s if s.contains("slam") => "Slam Attack",
        s if s.contains("slide") && s.contains("crit") => "Slide Critical Chance",
        s if s.contains("range") => "Range",
        _ => return ocr_name.to_string(),
    }
    .to_string()
}

/// The stats of the card before the reroll, from its OCR text.
fn parse_original_stats(text: Option<&str>) -> Vec<RivenStat> {
    let Some(text) = text else {
        return vec![];
    };
    let mut out = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if l.to_lowercase().starts_with('x')
            && l.len() > 2
            && l.chars()
                .nth(1)
                .is_some_and(|c| c.is_ascii_digit() || c == ' ')
        {
            let alpha_start = l
                .find(|c: char| c.is_alphabetic() && c != 'x')
                .unwrap_or(l.len());
            let val = l[..alpha_start]
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("");
            let name_part = l[alpha_start..]
                .trim()
                .split(" (")
                .next()
                .unwrap_or("")
                .trim();
            if !name_part.is_empty() {
                out.push(RivenStat {
                    name: ocr_stat_to_full_with_condition(name_part),
                    value: val,
                    positive: true,
                });
            }
            continue;
        }
        let fc = l.chars().next().unwrap_or(' ');
        let (is_pos, part) = if l.starts_with('+') {
            (true, l.trim_start_matches('+'))
        } else if l.starts_with('-') {
            (false, l.trim_start_matches('-'))
        } else if "•·○●◦".contains(fc) {
            (true, l.trim_start_matches(|c: char| "•·○●◦".contains(c)))
        } else {
            continue;
        };
        let val = if part.contains('%') {
            let n = part.split('%').next().unwrap_or("").trim();
            format!("{}{}%", if is_pos { "+" } else { "-" }, n)
        } else {
            // No % sign (element stats, OCR dropped it) — extract leading digits only
            let num_end = part
                .find(|c: char| !c.is_ascii_digit() && c != '.')
                .unwrap_or(part.len());
            format!("{}{}%", if is_pos { "+" } else { "-" }, &part[..num_end])
        };
        let sname: &str = if let Some(a) = part.split_once('%').map(|x| x.1) {
            a.trim()
        } else {
            let e = part.find(|c: char| c.is_alphabetic()).unwrap_or(0);
            part[e..].trim_start_matches(|c: char| !c.is_alphabetic())
        };
        if sname.is_empty() {
            continue;
        }
        let sname = sname.trim_start_matches(|c: char| !c.is_alphabetic());
        let sname = sname.split(" (").next().unwrap_or(sname).trim();
        out.push(RivenStat {
            name: ocr_stat_to_full_with_condition(sname),
            value: val,
            positive: is_pos,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verbatim OCR for the right-hand card of a reroll comparison screen (Kuva
    /// Bramma, 3840×2160), border and rank pips included as punctuation.
    const KUVA_BRAMMA_CARD_OCR: &str = "\
Kuva Bramma Lexi-
==
fevatin
;
-
+1.4 Punch Through
;
+22.2% Magazine
_
Capacity
-
-
\"
+23.6% Reload Speed ¢ Y
MR11
K Y
S
e
";

    #[test]
    fn wrapped_stat_names_rejoin_without_the_card_border() {
        let joined = join_wrapped_stat_lines(KUVA_BRAMMA_CARD_OCR);
        assert_eq!(
            joined,
            vec![
                "+1.4 Punch Through",
                // Wrapped across two lines with a border fragment between the halves.
                "+22.2% Magazine Capacity",
                // Trailing "¢ Y" is part of the line, so it survives; "MR11" does not.
                "+23.6% Reload Speed ¢ Y",
            ]
        );

        // All three still resolve. Trailing debris is fine, debris *inside* a
        // name ("Magazine _ Capacity") is not.
        assert_eq!(
            ocr_stat_to_full_with_condition("Magazine Capacity"),
            "Magazine Size"
        );
        assert_eq!(
            ocr_stat_to_full_with_condition("Reload Speed ¢ Y"),
            "Reload Speed"
        );
        assert_eq!(
            ocr_stat_to_full_with_condition("Punch Through"),
            "Punch Through"
        );
    }

    /// Both cards of a Kuva Nukor reroll screen. The left card's artwork puts
    /// stray glyphs in front of a sign, and its "Magazine Capacity" wraps.
    #[test]
    fn stats_survive_glyphs_in_front_of_the_sign() {
        let joined = join_wrapped_stat_lines(
            "\
Nukor Mantitin
)
+30.9% Magazine
Capacity
x1.29 Damage to Corpus P
v & -34.3% Critical Chance
H
O\\
M
",
        );
        assert_eq!(
            joined,
            vec![
                "+30.9% Magazine Capacity",
                "x1.29 Damage to Corpus P",
                // Without the prefix trim this line joined onto the multiplier
                // above it, losing both stats in one go.
                "-34.3% Critical Chance",
            ]
        );

        // The new roll, whose only oddity is the element icon read as "W".
        let joined = join_wrapped_stat_lines(
            "\
\\ukor Crita-hexapha
+76.6% Critical Chance
;
+43.3% Status Chance
+39.9% W Heat
p
-74.7% Damage
g
MR13
X N,
",
        );
        assert_eq!(
            joined,
            vec![
                "+76.6% Critical Chance",
                "+43.3% Status Chance",
                "+39.9% W Heat",
                "-74.7% Damage",
            ]
        );
        // Constructed, from the multi-byte glyphs this OCR emits elsewhere on the
        // card: four characters but six bytes, so a byte bound would leave it.
        assert_eq!(
            join_wrapped_stat_lines("x1.29 Damage to Corpus P\n¢ ¥ -34.3% Critical Chance\n"),
            vec!["x1.29 Damage to Corpus P", "-34.3% Critical Chance"]
        );

        assert_eq!(ocr_stat_to_full_with_condition("W Heat"), "Heat");
        assert_eq!(
            ocr_stat_to_full_with_condition("Damage to Corpus P"),
            "Damage to Corpus"
        );
    }

    /// The trim that rescues a stat could also destroy one, so it is bounded from
    /// both sides: reach the multiplier in either case, stop at anything wordlike.
    #[test]
    fn debris_trimming_stops_at_a_word_boundary() {
        // The multiplier is matched case-insensitively elsewhere, so debris in
        // front of a capital "X" has to be trimmed too.
        assert_eq!(
            join_wrapped_stat_lines("+50% Critical Chance\nv & X1.29 Damage to Corpus\n"),
            vec!["+50% Critical Chance", "X1.29 Damage to Corpus"]
        );

        // A sign glued to a word is part of it: this is a name wrapping
        // mid-hyphen, and trimming would leave "-1oad Speed".
        assert_eq!(
            join_wrapped_stat_lines("+50% Critical Chance\nRe-1oad Speed\n"),
            vec!["+50% Critical Chance Re-1oad Speed"]
        );

        // The rank label would otherwise trim into "-1" and read as a curse.
        assert_eq!(
            join_wrapped_stat_lines("+50% Critical Chance\nMR-1\n"),
            vec!["+50% Critical Chance"]
        );
    }

    /// Verbatim panel OCR from three reroll screens. The weapon name has to
    /// survive whether or not the grading sheet lists it: "kuva nukor" is not in
    /// the sheet, and reporting the base Nukor in its place would grade the roll
    /// against a different weapon's disposition.
    #[test]
    fn the_panel_yields_the_weapon_name_over_its_own_chrome() {
        let nukor = "o\n=\n\\\n[\"\no\nIN\n\u{fb01} 'A l\u{2019}\u{2019})\n\u{2014}\nKuva Nukor\n";
        assert_eq!(panel_weapon_candidates(nukor).last().unwrap(), "kuva nukor");

        let bramma = "-\nD\n)\nA\n~\n3\n\u{00a5}\nFITSIN\ne\nKuva Bramma\nSHOW RANKED\n";
        assert_eq!(
            panel_weapon_candidates(bramma).last().unwrap(),
            "kuva bramma"
        );

        // The single-card screen adds a CLOSE button below SHOW RANKED.
        let single = "\\\nE_ 3\n-\n-~\nFITSIN\n@\nKuva Bramma\nSHOW RANKED\nCLOSE\n";
        assert_eq!(
            panel_weapon_candidates(single).last().unwrap(),
            "kuva bramma"
        );

        // A panel that read as nothing but debris must not name a weapon.
        assert!(panel_weapon_candidates("\u{201c} \\\\\n>~ \u{2018}\n").is_empty());
    }

    /// The label is small enough that an engine can close the word gap.
    #[test]
    fn the_fits_in_marker_is_matched_without_its_space() {
        assert!(says_fits_in("fitsin"));
        assert!(says_fits_in("fits in"));
        assert!(says_fits_in("e\nfitsin\nkuva bramma"));
        assert!(!says_fits_in("inventory/mods"));
    }

    /// Titles must not glue onto a stat, and a negative stat is a real curse
    /// rather than junk. The second title is the one that matters: it follows the
    /// card above with no blank line, and is what the "kuva" noise rule holds back.
    #[test]
    fn stat_joining_keeps_curses_and_drops_the_mod_name() {
        let joined = join_wrapped_stat_lines(
            "\
Kuva Bramma Conci-
satitio
+50.3% Electricity
+57% Projectile Speed
+52.4% Multishot
-25.4% Ammo Maximum
Kuva Bramma Lexi-
MR 11
",
        );
        assert_eq!(
            joined,
            vec![
                "+50.3% Electricity",
                "+57% Projectile Speed",
                "+52.4% Multishot",
                "-25.4% Ammo Maximum",
            ]
        );
    }
}
