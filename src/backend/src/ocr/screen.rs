//! Capture and OCR of the game screen for the readers in this module, on top
//! of `hexdesk-capture` (`src/backend/crates/capture`).

use std::time::Instant;

use hexdesk_capture::{capture_game, Frame, Provider, Rect, TextRead};

/// The text OCR read with its segments: (text, [(segment, centre x, centre y)]).
pub type OcrResult = (String, Vec<(String, f32, f32)>);

/// Words further apart than this fraction of the picture width belong to
/// different reward cards: cards are 10 to 12 % apart, words within a name
/// about 3 %.
const CARD_GAP: f32 = 0.07;

/// The read split into segments at [`CARD_GAP`], and the text of those
/// segments, one per line.
fn segmented(read: &TextRead) -> OcrResult {
    let segments = read.segments(CARD_GAP);
    let mut text = String::new();
    for (segment, _, _) in &segments {
        text.push_str(segment);
        text.push('\n');
    }
    (text, segments)
}

/// The reward area: the top 80 % of the game window.
const REWARD_AREA: Rect = Rect::new(0.0, 1.0, 0.0, 0.8);
/// The band of the reward area the card names are read from, between the
/// screen title and the rarity bars (`src/backend/crates/overlays/src/read/reward/mod.rs`).
const REWARD_NAMES: Rect = Rect::new(0.0, 1.0, 0.08, 0.456);
/// A relic list: the left 60 % of the game window.
const RELIC_LIST: Rect = Rect::new(0.0, 0.6, 0.0, 1.0);
/// The top of a relic list, with its title and era line.
const RELIC_LIST_HEAD: Rect = Rect::new(0.0, 0.6, 0.0, 0.2);
/// The relic tiles, left of the panel of the selected relic
/// (`src/backend/crates/overlays/src/read/relic_list.rs`).
const RELIC_LIST_TILES: Rect = Rect::new(0.0, 0.45, 0.2, 1.0);
/// The screen title in the top-left corner.
const SCREEN_TITLE: Rect = Rect::new(0.0, 0.6, 0.0, 0.15);

/// A part of the game HexDesk reads; it names the log source of each read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reader {
    /// The screen title in the top-left corner.
    Title,
    /// The relic tiles of a relic selection or refinement screen.
    RelicList,
    /// The reward cards of the fissure reward screen.
    Rewards,
    /// The riven card and the riven comparison screen.
    Riven,
}

impl Reader {
    fn id(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::RelicList => "relicList",
            Self::Rewards => "rewards",
            Self::Riven => "riven",
        }
    }
}

/// Reads the text in a .bmp file, with Windows OCR where it is available,
/// and logs which engine read it and how long that took.
pub fn recognize(reader: Reader, bmp: &[u8], width: u32, height: u32) -> Result<TextRead, String> {
    let read = recognize_quiet(bmp, width, height);
    log_read(reader, &read.0, read.1);
    read.0
}

/// Reads the text in a .bmp file with one given engine, logged like
/// [`recognize`]: a second engine reading what the first could not.
pub fn recognize_with(
    reader: Reader,
    provider: Provider,
    bmp: &[u8],
    width: u32,
    height: u32,
) -> Result<TextRead, String> {
    let started = Instant::now();
    let read = hexdesk_capture::recognize_bmp_with(provider, bmp, width, height);
    log_read(reader, &read, started.elapsed().as_millis() as u64);
    read
}

/// [`recognize`] without the log entry, for a reader that polls.
fn recognize_quiet(bmp: &[u8], width: u32, height: u32) -> (Result<TextRead, String>, u64) {
    let started = Instant::now();
    let read = hexdesk_capture::recognize_bmp(bmp, width, height);
    (read, started.elapsed().as_millis() as u64)
}

fn log_read(reader: Reader, read: &Result<TextRead, String>, ocr_ms: u64) {
    let engine = read.as_ref().map_or("none", |read| read.engine.as_str());
    let id = reader.id();
    match reader {
        Reader::RelicList => {
            hexdesk_diag::debug!(relic_pick, reader = id, engine, ocr_ms, "OCR read")
        }
        Reader::Rewards => {
            hexdesk_diag::debug!(relic_reward, reader = id, engine, ocr_ms, "OCR read")
        }
        Reader::Riven => {
            hexdesk_diag::debug!(riven, reader = id, engine, ocr_ms, "OCR read")
        }
        Reader::Title => {
            hexdesk_diag::debug!(overlay, reader = id, engine, ocr_ms, "OCR read")
        }
    }
}

/// Reads the text in a .bmp file and splits it into segments.
fn run_ocr(reader: Reader, bmp: &[u8], width: u32, height: u32) -> Result<OcrResult, String> {
    recognize(reader, bmp, width, height).map(|read| segmented(&read))
}

/// The game window as BGRA pixels with their width and height.
pub fn capture_warframe_pixels() -> Result<(Vec<u8>, u32, u32), String> {
    let frame = capture_game()?.frame;
    Ok((frame.pixels, frame.width, frame.height))
}

/// The top 80 % of the game window, where the reward cards are, with how it
/// was captured.
pub fn capture_warframe_reward_area() -> Option<(Frame, String)> {
    let capture = capture_game().ok()?;
    crate::captures::save_areas("relic-reward", &capture.frame, &[REWARD_AREA, REWARD_NAMES]);
    let full_h = capture.frame.height;
    let area = capture.frame.crop(REWARD_AREA).ok()?;
    let mut info = format!(
        "{}  {}×{}px (top 80%, cap {}px)  avg_brightness={}",
        capture.method.name(),
        area.width,
        full_h,
        area.height,
        capture.brightness
    );
    if let Some(dark) = capture.print_window_brightness {
        info.push_str(&format!(" (PrintWindow was dark: avg={dark})"));
    }
    Some((area, info))
}

fn ocr_rect(pixels: &[u8], w: u32, h: u32, rect: Rect, gray: bool) -> Result<String, String> {
    let mut part = Frame::new(pixels.to_vec(), w, h).crop(rect)?;
    if gray {
        part = part.grayscale();
    }
    run_ocr(Reader::Riven, &part.to_bmp(), part.width, part.height).map(|(text, _)| text)
}

/// The text in a part of a captured riven screen, in grey; coordinates are
/// 0.0 to 1.0 fractions.
pub fn ocr_pixels_rect(
    pixels: &[u8],
    w: u32,
    h: u32,
    x_start: f32,
    x_end: f32,
    y_start: f32,
    y_end: f32,
) -> Result<String, String> {
    ocr_rect(
        pixels,
        w,
        h,
        Rect::new(x_start, x_end, y_start, y_end),
        true,
    )
}

/// The text in a part of a captured riven screen, as captured: white text on
/// a dark background reads well without the grey step.
pub fn ocr_pixels_rect_raw(
    pixels: &[u8],
    w: u32,
    h: u32,
    x_start: f32,
    x_end: f32,
    y_start: f32,
    y_end: f32,
) -> Result<String, String> {
    ocr_rect(
        pixels,
        w,
        h,
        Rect::new(x_start, x_end, y_start, y_end),
        false,
    )
}

/// A part of the screen with what OCR read in it.
pub struct ScreenRead {
    /// The bitmap OCR was given, as a .bmp file.
    pub image: Vec<u8>,
    /// Everything OCR read, with the place of each word.
    pub read: TextRead,
    /// The picture OCR was given (in grey).
    pub frame: Frame,
}

fn read_part(reader: Reader, frame: &Frame, rect: Rect) -> Result<ScreenRead, String> {
    let part = frame.crop(rect)?.grayscale();
    let image = part.to_bmp();
    let read = recognize(reader, &image, part.width, part.height)?;
    Ok(ScreenRead {
        image,
        read,
        frame: part,
    })
}

/// The left 60 % of the screen, where a relic list shows its era and its
/// relics.
pub fn read_relic_list() -> Result<ScreenRead, String> {
    let frame = capture_game()?.frame;
    crate::captures::save_areas("relic-list", &frame, &[RELIC_LIST_HEAD, RELIC_LIST_TILES]);
    read_part(Reader::RelicList, &frame, RELIC_LIST)
}

/// What was read from the screen title in the top-left corner of the game.
pub struct ScreenTitle {
    /// The text, such as "VOID FISSURE/SELECT RELIC"; None when OCR failed.
    pub text: Option<String>,
    /// The bitmap OCR was given for this text, as a .bmp file.
    pub image: Vec<u8>,
    /// The size the title area was read at: "1x", "2x" or "0.5x".
    pub scale: &'static str,
    /// Every size tried, in order, with the text OCR returned ("" when it
    /// failed) and whether `accept` took it.
    pub attempts: Vec<(&'static str, String, bool)>,
}

/// Reads the screen title, trying several sizes until `accept` takes the
/// text: OCR skips the title's thin, widely spaced letters at one size on one
/// screen and at another size on the next. Returns the accepted read, or the
/// last one. Fails when the game window cannot be captured.
pub fn read_screen_title(accept: impl Fn(&str) -> bool) -> Result<ScreenTitle, String> {
    read_screen_title_with(accept, false)
}

/// Reads the screen title without saving the outlined debug area or logging
/// each OCR read. Used by a background watcher, where doing so on every poll
/// would flood the captures list and the log.
pub fn read_screen_title_quiet(accept: impl Fn(&str) -> bool) -> Result<ScreenTitle, String> {
    read_screen_title_with(accept, true)
}

fn read_screen_title_with(
    accept: impl Fn(&str) -> bool,
    polled: bool,
) -> Result<ScreenTitle, String> {
    let frame = capture_game()?.frame;
    if !polled {
        crate::captures::save_areas("screen-title", &frame, &[SCREEN_TITLE]);
    }
    let gray = frame.crop(SCREEN_TITLE)?.grayscale();
    let sizes = [
        ("1x", gray.clone()),
        ("2x", gray.upscale_2x()),
        ("0.5x", gray.downscale_2x()),
    ];
    let mut attempts = Vec::new();
    let mut last = None;
    for (scale, frame) in sizes {
        let bmp = frame.to_bmp();
        let (read, ocr_ms) = recognize_quiet(&bmp, frame.width, frame.height);
        if !polled {
            log_read(Reader::Title, &read, ocr_ms);
        }
        let text = read.ok().map(|read| segmented(&read).0);
        let accepted = text.as_deref().is_some_and(&accept);
        attempts.push((scale, text.clone().unwrap_or_default(), accepted));
        last = Some((text, bmp, scale));
        if accepted {
            break;
        }
    }
    let (text, image, scale) = last.ok_or_else(|| "no title read".to_string())?;
    Ok(ScreenTitle {
        text,
        image,
        scale,
        attempts,
    })
}

/// Language tags of the installed Windows OCR language packs, for the
/// diagnostics export.
pub fn ocr_languages() -> Vec<String> {
    hexdesk_capture::languages()
}
