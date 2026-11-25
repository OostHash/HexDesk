//! Effect text as the game writes it, turned into plain lines.
//!
//! WFCD copies the game's strings: line breaks arrive as a literal `\n`, and
//! markup such as `<DT_FIRE_COLOR>` (damage type colour), `<ENERGY>` (an icon)
//! or `<LINE_SEPARATOR>` sits inside the text.

/// Damage types by the tag the game puts before their name, in the order the
/// game lists them: physical, primary elements, combined elements, others.
pub const DAMAGE_TYPES: [(&str, &str); 15] = [
    ("DT_IMPACT_COLOR", "Impact"),
    ("DT_PUNCTURE_COLOR", "Puncture"),
    ("DT_SLASH_COLOR", "Slash"),
    ("DT_FIRE_COLOR", "Heat"),
    ("DT_FREEZE_COLOR", "Cold"),
    ("DT_ELECTRICITY_COLOR", "Electricity"),
    ("DT_POISON_COLOR", "Toxin"),
    ("DT_EXPLOSION_COLOR", "Blast"),
    ("DT_CORROSIVE_COLOR", "Corrosive"),
    ("DT_GAS_COLOR", "Gas"),
    ("DT_MAGNETIC_COLOR", "Magnetic"),
    ("DT_RADIATION_COLOR", "Radiation"),
    ("DT_VIRAL_COLOR", "Viral"),
    ("DT_RADIANT_COLOR", "Void"),
    ("DT_SENTIENT", "Tau"),
];

/// The damage types the strings name through their damage-type tags, each
/// once, in [`DAMAGE_TYPES`] order. Plain words do not count: "Heat" in
/// "Turret Heat Capacity" is no damage type.
pub fn damage_types<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let texts: Vec<&str> = texts.into_iter().collect();
    DAMAGE_TYPES
        .iter()
        .filter(|(tag, _)| {
            let tag = format!("<{tag}>");
            texts.iter().any(|t| t.contains(&tag))
        })
        .map(|(_, name)| (*name).to_string())
        .collect()
}

/// One string of effect text as lines, without markup or empty lines.
pub fn lines(raw: &str) -> Vec<String> {
    let broken = raw
        .replace("\\n", "\n")
        .replace("\r\n", "\n")
        .replace("<LINE_SEPARATOR>", "\n");
    strip_markup(&broken)
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect()
}

/// The lines of every string listed for one rank, each line once.
///
/// WFCD lists some lines twice for one rank, once inside the main text and
/// once on their own (arcanes repeat "+1 Arcane Revive" that way).
pub fn rank_lines(stats: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in stats.iter().flat_map(|s| lines(s)) {
        if !out.contains(&line) {
            out.push(line);
        }
    }
    out
}

/// Removes tags made of upper-case letters, digits and underscores. Any other
/// `<` is ordinary text and stays.
fn strip_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('>') {
            Some(end) if is_tag(&after[..end]) => rest = &after[end + 1..],
            _ => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn is_tag(inner: &str) -> bool {
    !inner.is_empty()
        && inner
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_line_breaks_split_lines() {
        assert_eq!(
            lines("On Energy Pickup:\\n60% chance\\n15s cooldown"),
            vec!["On Energy Pickup:", "60% chance", "15s cooldown"]
        );
    }

    #[test]
    fn markup_is_removed_and_separators_break_lines() {
        assert_eq!(
            lines("+60% <DT_FIRE_COLOR>Heat<LINE_SEPARATOR><ENERGY> Energy  Max"),
            vec!["+60% Heat", "Energy Max"]
        );
    }

    #[test]
    fn a_lone_angle_bracket_is_text() {
        assert_eq!(lines("Range < 5m"), vec!["Range < 5m"]);
        assert_eq!(lines("a <b> c"), vec!["a <b> c"]);
    }

    #[test]
    fn damage_types_come_from_tags_in_game_order() {
        let texts = [
            "+150% <DT_VIRAL_COLOR>Viral and <DT_MAGNETIC_COLOR>Magnetic Damage",
            "+60% <DT_FREEZE_COLOR>Cold",
        ];
        assert_eq!(damage_types(texts), vec!["Cold", "Magnetic", "Viral"]);
    }

    #[test]
    fn plain_words_are_no_damage_type() {
        assert!(damage_types(["+27% Turret Heat Capacity"]).is_empty());
    }

    #[test]
    fn repeated_lines_in_one_rank_appear_once() {
        let stats = vec![
            "Replenish 100 Energy\\n+1 Arcane Revive".to_string(),
            "+1 Arcane Revive".to_string(),
        ];
        assert_eq!(
            rank_lines(&stats),
            vec!["Replenish 100 Energy", "+1 Arcane Revive"]
        );
    }
}
