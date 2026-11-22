//! Matching OCR words against reward names: OCR drops, garbles and merges
//! letters, so a name word counts as read when it is close enough.

use std::collections::HashSet;

/// The edit distance between two words; 99 when their lengths differ by
/// more than 3.
pub(super) fn lev_dist(a: &str, b: &str) -> usize {
    let a = a.as_bytes();
    let b = b.as_bytes();
    let (m, n) = (a.len(), b.len());
    if m.abs_diff(n) > 3 {
        return 99;
    }
    let mut prev: Vec<usize> = (0..=n).collect();
    let mut curr = vec![0usize; n + 1];
    for i in 1..=m {
        curr[0] = i;
        for j in 1..=n {
            curr[j] = if a[i - 1] == b[j - 1] {
                prev[j - 1]
            } else {
                1 + prev[j].min(curr[j - 1]).min(prev[j - 1])
            };
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[n]
}

/// Check whether `catalog_word` appears in `ocr_words` via:
///   1. Exact match
///   2. Prefix match: OCR truncated ("prime"→"pri", "voruna"→"vor")
///   3. Suffix substring: "neuroptics" → OCR gives "rüroptics"/"tearoptics" which
///      both contain "optics" — the distinctive suffix is preserved even when the
///      prefix is garbled. Check last 5+ chars as a substring in any OCR word.
///   4. Levenshtein ≤ 1 (or ≤ 2 for ≥8-char words) for single-char typos
///   5. Sliding-window inside longer merged tokens ("Sevagotfirime")
pub(super) fn word_found_in_set(catalog_word: &str, ocr_words: &HashSet<String>) -> bool {
    if ocr_words.contains(catalog_word) {
        return true;
    }
    if catalog_word.len() < 4 {
        return false;
    }

    // Prefix: OCR word is the leading portion of the catalog word
    for ocr_w in ocr_words {
        if ocr_w.len() >= 3 && catalog_word.starts_with(ocr_w.as_str()) {
            return true;
        }
    }

    // Suffix substring: check if last N chars of catalog word appear inside any OCR word
    if catalog_word.len() >= 6 {
        let suffix_len = (catalog_word.len() / 2).max(5);
        let suffix = &catalog_word[catalog_word.len() - suffix_len..];
        if ocr_words
            .iter()
            .any(|w| w.find(suffix).is_some_and(|p| p != 1))
        {
            return true;
        }
    }

    // Edit budget by word length
    let max_dist = if catalog_word.len() >= 8 {
        2
    } else if catalog_word.len() >= 5 {
        1
    } else {
        0
    };
    let wb = catalog_word.as_bytes();
    for ocr_w in ocr_words {
        if ocr_w.len() >= 4 {
            let dist = lev_dist(catalog_word, ocr_w);
            let len_diff = (catalog_word.len() as isize - ocr_w.len() as isize).unsigned_abs();
            if dist <= max_dist && !(len_diff == dist && len_diff >= 2) {
                return true;
            }
        }
        let ob = ocr_w.as_bytes();
        if ob.len() >= wb.len() + 4 {
            for (win_start, win) in ob.windows(wb.len()).enumerate() {
                let errs = wb.iter().zip(win.iter()).filter(|(a, b)| a != b).count();
                if errs == 0 && win_start + wb.len() == ob.len() && win_start >= 3 {
                    continue;
                }
                if errs <= max_dist {
                    return true;
                }
            }
        }
    }
    false
}

/// Normalise OCR text for catalog matching.
pub(super) fn normalise(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii() {
                return c.to_ascii_lowercase();
            }
            match c {
                'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' | 'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => {
                    'a'
                }
                'È' | 'É' | 'Ê' | 'Ë' | 'è' | 'é' | 'ê' | 'ë' => 'e',
                'Ì' | 'Í' | 'Î' | 'Ï' | 'ì' | 'í' | 'î' | 'ï' => 'i',
                'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
                'Ù' | 'Ú' | 'Û' | 'Ü' | 'ù' | 'ú' | 'û' | 'ü' => 'u',
                'Ñ' | 'ñ' => 'n',
                'Ç' | 'ç' => 'c',
                'Ý' | 'ý' | 'ÿ' => 'y',
                _ => ' ',
            }
        })
        .collect()
}

/// The read words that can name an item: not "prime", a part or a badge.
pub(super) fn extract_item_name_words(words: &HashSet<String>) -> Vec<String> {
    const SKIP: &[&str] = &[
        "prime",
        "blueprint",
        "owned",
        "crafted",
        "bl",
        "neuroptics",
        "systems",
        "chassis",
        "barrel",
        "stock",
        "receiver",
        "handle",
        "blade",
        "grip",
        "limb",
        "upper",
        "lower",
        "string",
        "link",
        "carapace",
        "cerebrum",
        "forma",
        "riven",
        "sliver",
        "ayatan",
    ];
    words
        .iter()
        .filter(|w| w.len() >= 3 && !SKIP.contains(&w.as_str()))
        .cloned()
        .collect()
}

/// The words of a card's text, lower case, letters only, three letters or
/// more. OCR reads "bl" as "@", "d" as ")" and " p" as "&".
pub(super) fn build_word_set(texts: &[String]) -> HashSet<String> {
    let corrected = texts
        .join(" ")
        .replace('@', "bl")
        .replace(')', "d")
        .replace('&', " p");
    normalise(&corrected)
        .chars()
        .map(|c| if c.is_ascii_alphabetic() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|w| w.len() >= 3)
        .map(|s| s.to_string())
        .collect()
}

/// How well a reward name fits the read words: 1.0 when every name word
/// was read, less for a partial match.
pub(super) fn score_item(display_name: &str, words: &HashSet<String>) -> f32 {
    let norm = normalise(display_name);
    let mut seen = HashSet::new();
    let item_words: Vec<&str> = norm
        .split_whitespace()
        .filter(|&w| seen.insert(w))
        .collect();
    if item_words.is_empty() {
        return 0.0;
    }
    let n_catalog = item_words.len() as f32;
    let n_ocr = words.len() as f32;
    let matched = item_words
        .iter()
        .filter(|&&w| word_found_in_set(w, words))
        .count();

    // A full catalog match scores 1.0. A partial match is capped at 0.9, so an
    // extra unmatched catalog word (e.g. "Chassis" on "Lavos Prime Chassis
    // Blueprint") can't beat the exact name via the length bonus below.
    let base = if matched == item_words.len() {
        1.0
    } else {
        (matched as f32 / n_catalog).max(if n_ocr > 0.0 {
            matched as f32 / n_ocr
        } else {
            0.0
        }) * 0.9
    };

    let len_bonus: f32 = item_words
        .iter()
        .filter(|&&w| !word_found_in_set(w, words))
        .map(|&cw| {
            words
                .iter()
                .map(|ow| {
                    let diff = (cw.len() as isize - ow.len() as isize).unsigned_abs();
                    if diff == 0 {
                        0.08_f32
                    } else if diff == 1 {
                        0.04
                    } else {
                        0.0
                    }
                })
                .fold(0.0_f32, f32::max)
        })
        .sum::<f32>()
        / n_catalog;

    base + len_bonus
}
