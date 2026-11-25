//! Effect text as the game writes it, turned into plain lines.
//!
//! WFCD copies the game's strings: line breaks arrive as a literal `\n`, and
//! markup such as `<DT_FIRE_COLOR>` (damage type colour), `<ENERGY>` (an icon)
//! or `<LINE_SEPARATOR>` sits inside the text.

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
