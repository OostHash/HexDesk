//! Reading a relic list for the Relic Pick overlay: its era and its relic
//! tiles from the screen, then the relics of that era from the inventory and
//! the catalogue, corrected by what the tiles show.

use std::time::{Duration, Instant};

use crate::ocr::Reader;
use hexdesk_capture::Provider;
use hexdesk_overlays::read::era_of_list;
use hexdesk_overlays::read::relic_list::{
    read_relic_list_with, Names, ReadLines, ReadText, RelicList,
};
use hexdesk_overlays::title::relic_list_screen_from_title;
use hexdesk_overlays::{Screen, VisitId};
use tracing::Span;

use super::{is_current, send, status, Input};
use crate::ocr::ScreenRead;

/// How often the list is read before giving up, and the pause in between.
/// Inside a mission the relic list follows the extract vote about two
/// seconds after EE.log reports it, and a panel from a hovered relic can
/// still fade out over it, so the list counts once two reads in a row agree.
const READ_ATTEMPTS: u32 = 8;
const READ_RETRY: Duration = Duration::from_millis(500);
/// The pause before the first read of a screen seen in EE.log.
const RENDER_WAIT: Duration = Duration::from_millis(400);

/// What the Relic Pick overlay is sent for one visit.
pub(crate) struct PickView {
    pub era: &'static str,
    /// Explicit selection/refinement classification from the OCR title.
    pub screen: Option<Screen>,
    /// How many relics of that era the payload lists.
    pub relics: usize,
    /// The `relic-pick-open` payload.
    pub payload: serde_json::Value,
}

/// Reads the relic list in the background and sends [`Input::PickReady`].
pub(super) fn read(app: tauri::AppHandle, visit: VisitId, wait_for_render: bool, op: Span) {
    std::thread::spawn(move || {
        let _guard = op.enter();
        status(&app, "Reading relic list…");
        if wait_for_render {
            std::thread::sleep(RENDER_WAIT);
        }
        let started = Instant::now();
        // The latest read that named an era, and its tiles.
        let mut latest: Option<(&'static str, RelicList, Option<Screen>)> = None;
        let mut stable = false;
        for attempt in 1..=READ_ATTEMPTS {
            if attempt > 1 {
                std::thread::sleep(READ_RETRY);
            }
            if !is_current(visit) {
                hexdesk_diag::info!(
                    relic_pick,
                    visit,
                    attempt,
                    "Relic list read stopped: the visit ended"
                );
                return;
            }
            let Some((era, list, screen)) = read_once(visit, attempt) else {
                continue;
            };
            let tiles = read_tiles(visit, era, &list, &app);
            let same = latest
                .as_ref()
                .is_some_and(|(e, t, _)| *e == era && t.reads_the_same(&tiles));
            // Keep an explicit title classification from an earlier retry if
            // a later otherwise-stable OCR read misses the title.
            let screen = screen.or_else(|| latest.as_ref().and_then(|(_, _, screen)| *screen));
            latest = Some((era, tiles, screen));
            if same {
                stable = true;
                break;
            }
        }
        if latest.is_some() && !stable {
            hexdesk_diag::info!(
                relic_pick,
                visit,
                attempts = READ_ATTEMPTS,
                "Relic list not the same in two reads in a row; the last read is used"
            );
        }
        let pick = latest.map(|(era, tiles, screen)| {
            let (payload, changes) =
                crate::relic_pick::build_relic_pick_payload(era, &app, Some(&tiles));
            for change in &changes {
                hexdesk_diag::info!(
                    relic_pick,
                    visit,
                    relic = %change.relic,
                    "Relic Pick follows the screen: {}",
                    change.change
                );
            }
            let relics = payload["relics"].as_array().map_or(0, Vec::len);
            PickView {
                era,
                screen,
                relics,
                payload,
            }
        });
        hexdesk_diag::debug!(
            relic_pick,
            visit,
            read_ms = started.elapsed().as_millis() as u64,
            "Relic Pick read finished"
        );
        send(Input::PickReady { visit, pick });
    });
}

/// One read of the relic list, logged with the era line OCR returned and,
/// when captures are on, the picture and the OCR result.
fn read_once(visit: VisitId, attempt: u32) -> Option<(&'static str, ScreenRead, Option<Screen>)> {
    let list = match crate::ocr::read_relic_list() {
        Ok(list) => list,
        Err(reason) => {
            hexdesk_diag::info!(
                relic_pick,
                visit,
                attempt,
                reason = %reason,
                "Relic list could not be read"
            );
            return None;
        }
    };
    let era = era_of_list(&list.read);
    let head = list
        .read
        .lines
        .iter()
        .filter(|l| l.words.first().is_some_and(|w| w.top < 0.2))
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let screen = relic_list_screen_from_title(&head);
    crate::testing::save_read(visit, "relic-list", &list.image, &list.read);
    let capture = if crate::captures::enabled() {
        crate::captures::save_read("relic-list", &list.image, &list.read)
    } else {
        None
    };
    match capture {
        Some(capture) => hexdesk_diag::info!(
            relic_pick,
            visit,
            attempt,
            era = era.unwrap_or("none"),
            screen = screen.map_or("not explicit", Screen::name),
            capture = %capture,
            "Relic list head read: \"{head}\""
        ),
        None => hexdesk_diag::info!(
            relic_pick,
            visit,
            attempt,
            era = era.unwrap_or("none"),
            screen = screen.map_or("not explicit", Screen::name),
            "Relic list head read: \"{head}\""
        ),
    }
    era.map(|era| (era, list, screen))
}

/// The relic tiles on the list, logged one line for the whole list.
fn read_tiles(visit: VisitId, era: &str, list: &ScreenRead, app: &tauri::AppHandle) -> RelicList {
    let all = crate::relic_pick::era_relic_names(era, app);
    let owned = crate::relic_pick::owned_relic_names(era, app);
    let names = Names {
        owned: &owned,
        all: &all,
    };
    let reread = |part: &hexdesk_capture::Frame| {
        crate::ocr::recognize(Reader::RelicList, &part.to_bmp(), part.width, part.height)
            .ok()
            .map(|read| read.text().split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|text| !text.trim().is_empty())
    };
    // Windows OCR skips small texts and drops some names in the whole list,
    // so it reads the tags and badges of owned tiles on their own, and ocrs
    // reads what it still could not, when the player allowed its models.
    let windows = list.read.engine == "windows";
    let fallback =
        (windows && crate::ocr::ocrs_fallback()).then_some(|part: &hexdesk_capture::Frame| {
            crate::ocr::recognize_with(
                Reader::RelicList,
                Provider::Ocrs,
                &part.to_bmp(),
                part.width,
                part.height,
            )
            .ok()
        });
    let tiles = read_relic_list_with(
        &list.read,
        &list.frame,
        &names,
        &reread,
        windows.then_some(&reread as ReadText<'_>),
        fallback.as_ref().map(|f| f as ReadLines<'_>),
    );
    let named = tiles.tiles.iter().filter(|t| t.relic.is_some()).count();
    let faded = tiles
        .tiles
        .iter()
        .filter(|t| t.owned == Some(false))
        .count();
    let collected = tiles
        .collected
        .map_or_else(|| "not read".to_string(), |(a, b)| format!("{a}/{b}"));
    hexdesk_diag::info!(
        relic_pick,
        visit,
        tiles = tiles.tiles.len(),
        named,
        faded,
        collected = %collected,
        complete = tiles.complete,
        engine = %list.read.engine,
        fallback = fallback.is_some(),
        "Relic tiles read: {}",
        tiles.summary()
    );
    tiles
}
