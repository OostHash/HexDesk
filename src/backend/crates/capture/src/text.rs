//! What OCR read: lines of words, each with its place in the picture.

use serde::{Deserialize, Serialize};

/// A word and its bounding box, in fractions of the picture OCR was given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub text: String,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

impl Word {
    pub fn center_x(&self) -> f32 {
        self.left + self.width / 2.0
    }

    pub fn center_y(&self) -> f32 {
        self.top + self.height / 2.0
    }

    pub fn right(&self) -> f32 {
        self.left + self.width
    }
}

/// A line as OCR grouped it: words on the same baseline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    /// The line's text; also set when OCR gave no words for it.
    pub text: String,
    pub words: Vec<Word>,
}

/// Everything OCR read in one picture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextRead {
    /// The OCR engine: "windows" or "ocrs".
    pub engine: String,
    /// Size of the picture OCR was given, in pixels.
    pub width: u32,
    pub height: u32,
    pub lines: Vec<Line>,
}

impl TextRead {
    /// The text, one line per line.
    pub fn text(&self) -> String {
        self.lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Lines split wherever the gap between two words is wider than `gap`
    /// (a fraction of the picture width), each with the text and the centre
    /// of its words. OCR puts words on one line when they share a baseline,
    /// which merges the names of two reward cards side by side.
    pub fn segments(&self, gap: f32) -> Vec<(String, f32, f32)> {
        let mut out = Vec::new();
        for line in &self.lines {
            if line.words.is_empty() {
                out.push((line.text.clone(), 0.5, 0.5));
                continue;
            }
            let mut segment: Vec<&Word> = Vec::new();
            for word in &line.words {
                if let Some(last) = segment.last() {
                    if word.left - last.right() > gap {
                        out.push(segment_of(&segment));
                        segment.clear();
                    }
                }
                segment.push(word);
            }
            if !segment.is_empty() {
                out.push(segment_of(&segment));
            }
        }
        out
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_default()
    }

    pub fn from_json(json: &str) -> Result<TextRead, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }
}

fn segment_of(words: &[&Word]) -> (String, f32, f32) {
    let n = words.len() as f32;
    let text = words
        .iter()
        .map(|w| w.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let x = words.iter().map(|w| w.center_x()).sum::<f32>() / n;
    let y = words.iter().map(|w| w.center_y()).sum::<f32>() / n;
    (text, x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, left: f32, width: f32) -> Word {
        Word {
            text: text.into(),
            left,
            top: 0.4,
            width,
            height: 0.2,
        }
    }

    fn read(lines: Vec<Line>) -> TextRead {
        TextRead {
            engine: "test".into(),
            width: 100,
            height: 10,
            lines,
        }
    }

    #[test]
    fn a_wide_gap_splits_two_card_names() {
        let line = Line {
            text: "Daikyu Prime Upper Limb Nautilus Prime Systems".into(),
            words: vec![
                word("Daikyu", 0.05, 0.05),
                word("Prime", 0.11, 0.04),
                word("Nautilus", 0.30, 0.06),
                word("Prime", 0.37, 0.04),
            ],
        };
        let segments = read(vec![line]).segments(0.07);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].0, "Daikyu Prime");
        assert_eq!(segments[1].0, "Nautilus Prime");
        assert!((segments[0].2 - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_line_without_words_keeps_its_text() {
        let line = Line {
            text: "FORMA".into(),
            words: vec![],
        };
        assert_eq!(
            read(vec![line]).segments(0.07),
            [("FORMA".to_string(), 0.5, 0.5)]
        );
    }

    #[test]
    fn a_read_round_trips_through_json() {
        let original = read(vec![Line {
            text: "AXI ERA".into(),
            words: vec![word("AXI", 0.1, 0.05), word("ERA", 0.16, 0.05)],
        }]);
        assert_eq!(TextRead::from_json(&original.to_json()).unwrap(), original);
        assert_eq!(original.text(), "AXI ERA");
    }
}
