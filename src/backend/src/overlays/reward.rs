//! Reading the fissure reward screen for the Relic Reward overlay: the
//! reward cards, read again until the read can be trusted.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use hexdesk_diag::{debug, info};
use hexdesk_overlays::read::reward::{Confirm, RewardCard, RewardScreen, ShownCard, Verdict};
use hexdesk_overlays::title::screen_from_title;
use hexdesk_overlays::{Screen, Signal, VisitId};
use tauri::{Emitter, Manager};
use tracing::{Instrument, Span};

use super::{is_current, now, send, Input};
use crate::app_state::AppState;
use crate::events;

/// What the EE.log watcher collects for reading reward cards.
pub(crate) struct RewardContext {
    /// Relics loaded this mission, which narrow the rewards a card can be.
    pub session_relics: Mutex<Vec<String>>,
    /// How many cards the squad's rewards make, once EE.log says so.
    pub squad_size: Arc<Mutex<Option<usize>>>,
    /// Player names, which OCR text must not be matched to.
    pub squad_names: Arc<Mutex<Vec<String>>>,
    /// Every reward of every relic: (path, name).
    pub catalog: Arc<Vec<(String, String)>>,
    /// The inventory scanner is on; reward reads follow it.
    pub scanner_on: Arc<AtomicBool>,
}

static CONTEXT: OnceLock<RewardContext> = OnceLock::new();

/// Hands over what the EE.log watcher collects. Called once at startup.
pub(crate) fn set_context(context: RewardContext) {
    let _ = CONTEXT.set(context);
}

/// The relics loaded this mission, as the EE.log watcher collected them.
pub(crate) fn set_session_relics(relics: &[String]) {
    if let Some(context) = CONTEXT.get() {
        *context
            .session_relics
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = relics.to_vec();
    }
}

/// Gives up when no read can be trusted within this time.
const READ_LIMIT: Duration = Duration::from_secs(45);

/// How often title OCR checks that a shown reward screen is still present.
const TITLE_WATCH_INTERVAL: Duration = Duration::from_millis(750);
/// One missed title may be an OCR slip; three in a row means the screen left.
const TITLE_MISSES_TO_CLOSE: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TitleWatchDecision {
    Continue,
    Report(Option<Screen>),
}

fn title_watch_decision(screen: Option<Screen>, misses: &mut u8) -> TitleWatchDecision {
    match screen {
        Some(Screen::RewardChoice) => {
            *misses = 0;
            TitleWatchDecision::Continue
        }
        Some(other) => TitleWatchDecision::Report(Some(other)),
        None => {
            *misses = misses.saturating_add(1);
            if *misses >= TITLE_MISSES_TO_CLOSE {
                TitleWatchDecision::Report(None)
            } else {
                TitleWatchDecision::Continue
            }
        }
    }
}

/// While a drawn reward overlay is visible, use the existing title OCR as a
/// fallback for delayed or missing EE.log close lines.
pub(super) fn watch_title(visit: VisitId, op: Span) {
    tauri::async_runtime::spawn(
        async move {
            let mut misses = 0u8;
            loop {
                tokio::time::sleep(TITLE_WATCH_INTERVAL).await;
                if !is_current(visit) || !super::reward_shown() {
                    return;
                }

                let read = tauri::async_runtime::spawn_blocking(|| {
                    crate::ocr::read_screen_title_quiet(|text| {
                        screen_from_title(text).is_some()
                    })
                })
                .await;
                if !is_current(visit) || !super::reward_shown() {
                    return;
                }
                let screen = match read {
                    Ok(Ok(title)) => title.text.as_deref().and_then(screen_from_title),
                    Ok(Err(reason)) => {
                        debug!(relic_reward, visit, reason, "Reward title OCR failed");
                        None
                    }
                    Err(reason) => {
                        debug!(relic_reward, visit, reason = %reason, "Reward title OCR task failed");
                        None
                    }
                };

                match title_watch_decision(screen, &mut misses) {
                    TitleWatchDecision::Continue => {
                        if screen.is_none() {
                            debug!(
                                relic_reward,
                                visit,
                                misses,
                                "Reward title not found; checking again"
                            );
                        }
                    }
                    TitleWatchDecision::Report(observed) => {
                        match observed {
                            Some(screen) => info!(
                                relic_reward,
                                visit,
                                screen = screen.name(),
                                "Reward title watcher saw another screen"
                            ),
                            None => info!(
                                relic_reward,
                                visit,
                                misses,
                                "Reward title watcher no longer found the reward screen"
                            ),
                        }
                        send(Input::Signals(vec![Signal::observed_title(now(), observed)]));
                        return;
                    }
                }
            }
        }
        .instrument(op),
    );
}

/// Reads the reward cards in the background and sends
/// [`Input::RewardReady`]. `by_key` is a read the overlay key asked for: it is
/// ahead of EE.log, so the relics of this round are not known yet and every
/// reward is a candidate.
pub(super) fn read(app: tauri::AppHandle, visit: VisitId, by_key: bool, op: Span) {
    let Some(context) = CONTEXT.get() else {
        return;
    };
    let session_relics = context
        .session_relics
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let span = op.clone();
    let _guard = span.enter();
    if !context.scanner_on.load(Ordering::SeqCst) {
        info!(
            relic_reward,
            visit, "Reward cards not read: the inventory scanner is off"
        );
        return;
    }
    // Requiem relics (Kuva Lich and Sister rewards) have no fissure rewards
    // in the catalogue, so their cards would only be mismatched.
    if session_relics
        .iter()
        .any(|p| p.contains("T5VoidProjection"))
    {
        info!(
            relic_reward,
            visit, "Reward cards not read: a Requiem relic was used this mission"
        );
        return;
    }
    prepare_reward_trigger(
        &app,
        &context.squad_names,
        &context.squad_size,
        &session_relics,
    );
    let candidates = if by_key {
        RewardCandidates {
            catalog: Arc::clone(&context.catalog),
            from: "every reward: opened with the overlay key, ahead of EE.log",
            relics: Vec::new(),
        }
    } else {
        build_relic_reward_catalog(&app, &session_relics, &context.catalog)
    };
    let catalog = candidates.catalog;
    info!(
        relic_reward,
        visit,
        candidates = catalog.len(),
        from = candidates.from,
        relics = %candidates.relics.join(", "),
        "Reward card read started"
    );
    let squad = Arc::clone(&context.squad_size);
    let names = Arc::clone(&context.squad_names);
    let full = Arc::clone(&context.catalog);
    drop(_guard);
    tauri::async_runtime::spawn(
        read_until_trusted(app, visit, catalog, full, squad, names).instrument(op),
    );
}

/// What one reward read ends with.
pub(crate) struct RewardResult {
    /// `{ items, positions, uncertain }` for the overlay; None when nothing
    /// was read.
    pub payload: Option<serde_json::Value>,
    /// Cards that matched a reward.
    pub cards: usize,
    pub attempts: u32,
    pub reason: &'static str,
}

impl RewardResult {
    fn of(cards: Option<Vec<ShownCard>>, attempts: u32, reason: &'static str) -> RewardResult {
        RewardResult {
            cards: cards.iter().flatten().filter(|c| c.item.is_some()).count(),
            payload: cards.map(|cards| payload(&cards)),
            attempts,
            reason,
        }
    }
}

/// The overlay's view of the cards: the reward path per card, or "?:" and
/// the text OCR read for a card that matched nothing; the card's centre;
/// and whether the match is uncertain.
fn payload(cards: &[ShownCard]) -> serde_json::Value {
    let items: Vec<String> = cards
        .iter()
        .map(|c| match &c.item {
            Some(item) => item.clone(),
            None => format!("?:{}", c.text),
        })
        .collect();
    let positions: Vec<f32> = cards.iter().map(|c| c.x).collect();
    let uncertain: Vec<bool> = cards.iter().map(|c| c.item.is_some() && !c.sure).collect();
    serde_json::json!({ "items": items, "positions": positions, "uncertain": uncertain })
}

async fn read_until_trusted(
    app: tauri::AppHandle,
    visit: VisitId,
    mut catalog: Arc<Vec<(String, String)>>,
    full: Arc<Vec<(String, String)>>,
    squad: Arc<Mutex<Option<usize>>>,
    names: Arc<Mutex<Vec<String>>>,
) {
    let started = Instant::now();
    let since = || started.elapsed().as_millis() as u64;
    wait_for_squad_hint(&squad).await;

    let mut confirm = Confirm::new();
    let mut no_match_streak = 0u32;
    let mut attempt = 0u32;
    let finish = |result: RewardResult| send(Input::RewardReady { visit, result });

    loop {
        attempt += 1;
        if !is_current(visit) {
            info!(
                relic_reward,
                visit,
                attempt,
                since_trigger_ms = since(),
                "Reward card read stopped: the visit ended"
            );
            return;
        }
        // The catalogue is empty when the read started before it loaded.
        if catalog.is_empty() {
            if let Some(fallback) = build_fallback_reward_catalog(&app) {
                catalog = fallback;
            }
        }
        let captured = capture_reward_items(
            visit,
            Arc::clone(&catalog),
            Arc::clone(&squad),
            Arc::clone(&names),
        )
        .await;
        if let Some(saved) = captured.as_ref().and_then(|c| c.saved.as_ref()) {
            info!(relic_reward, visit, attempt, capture = %saved, "Reward area recorded");
        }
        log_attempt(attempt, since(), captured.as_ref());

        let wait_ms = match captured.map(|c| c.screen) {
            Some(Ok(RewardScreen::Cards(read))) if read.matched() > 0 => {
                no_match_streak = 0;
                match confirm.add(read) {
                    Verdict::Show { cards, reason } => {
                        finish(RewardResult::of(Some(cards), attempt, reason));
                        return;
                    }
                    Verdict::Wait => 400,
                }
            }
            Some(Ok(RewardScreen::NoText { dark: true })) => retry_after_dark_frame(&app),
            Some(Ok(RewardScreen::NoText { dark: false })) => retry_after_ocr_empty(&app),
            Some(_) => retry_after_no_match(&app, &mut no_match_streak, &mut catalog, &full),
            None => retry_after_capture_failed(&app),
        };

        if started.elapsed() >= READ_LIMIT {
            let best = confirm.best_cards();
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::RelicReward,
                hexdesk_diag::Kind::Timeout,
                "Reward cards: no read could be trusted within 45 s",
            )
            .with("attempts", attempt)
            .with(
                "best_cards",
                best.iter().flatten().filter(|c| c.item.is_some()).count(),
            )
            .log();
            finish(RewardResult::of(
                best,
                attempt,
                "time limit; the best read so far",
            ));
            return;
        }
        tokio::time::sleep(Duration::from_millis(wait_ms)).await;
    }
}

/// The alternatives of a card, best first: `name 0.63 · name 0.60`.
fn describe_alternatives(card: &RewardCard) -> String {
    card.alternatives
        .iter()
        .map(|(name, score)| format!("{name} {score:.2}"))
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Logs what one OCR attempt on the reward screen read: one line for the
/// attempt and one per card.
fn log_attempt(attempt: u32, since_trigger_ms: u64, captured: Option<&RewardCapture>) {
    let Some(captured) = captured else {
        let _ = hexdesk_diag::DiagError::new(
            hexdesk_diag::Source::RelicReward,
            hexdesk_diag::Kind::NotFound,
            "OCR attempt failed: Warframe window not found",
        )
        .with("attempt", attempt)
        .log();
        return;
    };
    let (capture_ms, ocr_ms) = (captured.capture_ms, captured.ocr_ms);
    match &captured.screen {
        Ok(RewardScreen::Cards(read)) => {
            let skipped = read
                .lines
                .iter()
                .filter_map(|l| l.skipped.map(|why| format!("\"{}\" ({why})", l.text)))
                .collect::<Vec<_>>()
                .join(", ");
            debug!(
                relic_reward,
                attempt,
                since_trigger_ms,
                capture_ms,
                ocr_ms,
                cards = read.cards.len(),
                matched = read.matched(),
                expected = read.expected,
                expected_from = read.expected_from.name(),
                columns = read.columns.name(),
                bars = %read.bars,
                skipped = %skipped,
                capture = %captured.info,
                "OCR attempt read reward cards"
            );
            for (card, index) in read.cards.iter().zip(1u32..) {
                debug!(
                    relic_reward,
                    attempt,
                    card = index,
                    x = %format!("{:.2}", card.x),
                    text = %card.text,
                    item = card.name.as_deref().unwrap_or("none"),
                    score = %format!("{:.2}", card.score),
                    matched_by = card.matched_by.name(),
                    sure = card.sure,
                    next_best = %describe_alternatives(card),
                    "Reward card"
                );
            }
        }
        Ok(RewardScreen::NoText { dark }) => {
            debug!(
                relic_reward,
                attempt,
                since_trigger_ms,
                capture_ms,
                ocr_ms,
                dark = *dark,
                capture = %captured.info,
                "OCR attempt read no text"
            );
        }
        Ok(RewardScreen::RelicList) => {
            debug!(
                relic_reward,
                attempt, since_trigger_ms, "OCR attempt read a relic list, not reward cards"
            );
        }
        Err(why) => {
            let _ = hexdesk_diag::DiagError::new(
                hexdesk_diag::Source::RelicReward,
                hexdesk_diag::Kind::Internal,
                "OCR attempt failed",
            )
            .with("attempt", attempt)
            .with("reason", why)
            .log();
        }
    }
}

/// The rewards a reward card can be, and why.
pub(crate) struct RewardCandidates {
    /// (path, name) of every candidate reward.
    pub catalog: std::sync::Arc<Vec<(String, String)>>,
    /// Where the candidates come from.
    pub from: &'static str,
    /// The relics the candidates were narrowed to, by name ("Neo R5
    /// Radiant"); empty when every reward is a candidate.
    pub relics: Vec<String>,
}

/// Narrows the rewards a card can be to those of the relics EE.log named
/// this mission; every reward when it named none or none of them is known.
pub(crate) fn build_relic_reward_catalog(
    app: &tauri::AppHandle,
    session_relics: &[String],
    full_catalog: &std::sync::Arc<Vec<(String, String)>>,
) -> RewardCandidates {
    let every = |from| RewardCandidates {
        catalog: std::sync::Arc::clone(full_catalog),
        from,
        relics: Vec::new(),
    };
    if session_relics.is_empty() {
        return every("every reward: EE.log named no relic this mission");
    }
    let state = app.state::<AppState>();
    let mut rewards: Vec<(String, String)> = {
        let reward_map = state
            .relic_rewards
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        session_relics
            .iter()
            .filter_map(|path| reward_map.get(path.as_str()))
            .flat_map(|rewards| {
                rewards
                    .iter()
                    .map(|reward| (reward.unique_name.clone(), reward.name.clone()))
            })
            .filter(|(_, name)| !name.is_empty())
            .collect()
    };
    if rewards.is_empty() {
        return every("every reward: no known rewards for the relics EE.log named");
    }
    rewards.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    rewards.dedup_by(|a, b| !a.0.is_empty() && a.0 == b.0);
    let relics = {
        let items = state.wfcd_items.lock().unwrap_or_else(|e| e.into_inner());
        session_relics
            .iter()
            .map(|path| {
                items
                    .iter()
                    .find(|item| item.unique_name == *path)
                    .map_or_else(|| path.clone(), |item| item.name.clone())
            })
            .collect()
    };
    RewardCandidates {
        catalog: std::sync::Arc::new(rewards),
        from: "the relics EE.log named this mission",
        relics,
    }
}

/// Build a fallback OCR catalog when the initial cache was empty at monitor startup.
pub(crate) fn build_fallback_reward_catalog(
    app: &tauri::AppHandle,
) -> Option<std::sync::Arc<Vec<(String, String)>>> {
    let state = app.state::<AppState>();
    let items = state.wfcd_items.lock().unwrap_or_else(|e| e.into_inner());
    if items.is_empty() {
        return None;
    }
    let blueprints = state
        .blueprint_to_result
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let excluded = [
        "Warframes",
        "Primary",
        "Secondary",
        "Melee",
        "Companion",
        "Sentinels",
        "Archwing",
        "Arch-Gun",
        "Arch-Melee",
        "Pets",
        "Robotic",
    ];
    let mut catalog: Vec<(String, String)> = items
        .iter()
        .filter(|item| {
            let name = item.name.to_lowercase();
            !excluded.contains(&item.category.as_str())
                && !name.ends_with("intact")
                && !name.ends_with("exceptional")
                && !name.ends_with("flawless")
                && !name.ends_with("radiant")
                && (name.contains("prime") || name.starts_with("forma"))
        })
        .map(|item| (item.unique_name.clone(), item.name.clone()))
        .collect();
    for (path, (name, _)) in blueprints.iter() {
        let lower = name.to_lowercase();
        if lower.contains("prime") || lower.starts_with("forma") {
            catalog.push((path.clone(), name.clone()));
        }
    }
    catalog.sort_by(|a, b| a.0.cmp(&b.0));
    catalog.dedup_by(|a, b| a.0 == b.0);
    (!catalog.is_empty()).then(|| std::sync::Arc::new(catalog))
}

/// Prepare OCR hints immediately when a relic reward screen is triggered.
pub(crate) fn prepare_reward_trigger(
    app: &tauri::AppHandle,
    squad_names: &std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    squad_size: &std::sync::Arc<std::sync::Mutex<Option<usize>>>,
    session_relics: &[String],
) {
    if let Ok(local_player) = app.state::<AppState>().local_player_name.lock() {
        if let Some(name) = local_player.as_ref() {
            if let Ok(mut names) = squad_names.lock() {
                if !names.iter().any(|existing| existing == name) {
                    names.push(name.clone());
                }
            }
        }
    }
    let relic_hint = session_relics.len().min(4);
    if relic_hint >= 1 {
        if let Ok(mut hint) = squad_size.lock() {
            if hint.is_none() {
                *hint = Some(relic_hint);
            }
        }
    }
}

/// Give the VoidProjections sequence a short window to provide an OCR card-count hint.
pub(crate) async fn wait_for_squad_hint(
    squad_size: &std::sync::Arc<std::sync::Mutex<Option<usize>>>,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if squad_size.lock().ok().is_some_and(|hint| hint.is_some()) {
            break;
        }
    }
}

/// One capture of the reward area and what the card reader made of it.
pub(crate) struct RewardCapture {
    /// The cards, or why OCR failed.
    pub screen: Result<hexdesk_overlays::read::reward::RewardScreen, String>,
    /// How the area was captured.
    pub info: String,
    /// With captures on: the saved picture of the reward area and what OCR
    /// read in it, a test fixture for the card reader.
    pub saved: Option<String>,
    pub capture_ms: u64,
    pub ocr_ms: u64,
}

/// Captures the reward area and reads the cards, with the squad size and
/// player names EE.log gave so far. None when the game window was not found.
pub(crate) async fn capture_reward_items(
    visit: VisitId,
    catalog: std::sync::Arc<Vec<(String, String)>>,
    squad_size: std::sync::Arc<std::sync::Mutex<Option<usize>>>,
    squad_names: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) -> Option<RewardCapture> {
    use hexdesk_overlays::read::reward::{read_reward_screen, RewardInput};
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        let (frame, info) = crate::ocr::capture_warframe_reward_area()?;
        let capture_ms = started.elapsed().as_millis() as u64;
        let bmp = frame.to_bmp();
        let read =
            crate::ocr::recognize(crate::ocr::Reader::Rewards, &bmp, frame.width, frame.height);
        let ocr_ms = started.elapsed().as_millis() as u64 - capture_ms;
        if let Ok(read) = &read {
            crate::testing::save_read(visit, "relic-reward", &bmp, read);
        }
        let saved = match &read {
            Ok(read) if crate::captures::enabled() => {
                crate::captures::save_read("relic-reward", &bmp, read)
            }
            _ => None,
        };
        let squad_size = squad_size.lock().ok().and_then(|hint| *hint);
        let player_names = squad_names
            .lock()
            .map(|names| names.clone())
            .unwrap_or_default();
        let screen = read.map(|text| {
            read_reward_screen(&RewardInput {
                text: &text,
                frame: &frame,
                catalog: &catalog,
                squad_size,
                player_names: &player_names,
            })
        });
        Some(RewardCapture {
            screen,
            info,
            saved,
            capture_ms,
            ocr_ms,
        })
    })
    .await
    .ok()
    .flatten()
}

/// Store the payload for a late overlay mount, then notify the frontend.
pub(crate) fn publish_relic_rewards(app: &tauri::AppHandle, payload: Option<&serde_json::Value>) {
    if payload.is_some_and(|payload| !payload.is_null())
        && !app
            .state::<AppState>()
            .overlays_enabled
            .load(Ordering::SeqCst)
    {
        return;
    }
    if let Some(payload) = payload.filter(|payload| !payload.is_null()) {
        if let Ok(mut pending) = app.state::<AppState>().pending_relic_rewards.lock() {
            *pending = Some(payload.clone());
        }
    }
    let _ = app.emit(events::RELIC_REWARDS, payload);
}

/// A dark frame: show it in the status line, retry soon. Returns the wait in ms.
pub(crate) fn retry_after_dark_frame(app: &tauri::AppHandle) -> u64 {
    super::status(app, "Reward area is still dark");
    100
}

/// No text read: show it in the status line, retry. Returns the wait in ms.
pub(crate) fn retry_after_ocr_empty(app: &tauri::AppHandle) -> u64 {
    super::status(app, "Waiting for reward text…");
    300
}

/// The game window was not captured: retry. Returns the wait in ms.
pub(crate) fn retry_after_capture_failed(app: &tauri::AppHandle) -> u64 {
    super::status(app, "Could not capture the game; retrying…");
    500
}

/// Text read but no reward matched. After three misses in a row the catalogue
/// widens from this session's relics to every reward. Returns the wait in ms.
pub(crate) fn retry_after_no_match(
    app: &tauri::AppHandle,
    no_match_streak: &mut u32,
    cat: &mut std::sync::Arc<Vec<(String, String)>>,
    fallback_cat: &std::sync::Arc<Vec<(String, String)>>,
) -> u64 {
    *no_match_streak += 1;
    if *no_match_streak == 3 && cat.len() < fallback_cat.len() {
        *cat = std::sync::Arc::clone(fallback_cat);
        hexdesk_diag::info!(
            relic_reward,
            catalog = cat.len(),
            "Reward catalogue widened to every reward after 3 reads without a match"
        );
    }
    super::status(app, "No reward match yet; retrying…");
    700
}

/// Hides the Relic Reward window: parked off screen, since destroying and
/// creating transparent WebView2 windows deadlocks on Windows.
pub(super) fn hide(app: &tauri::AppHandle) {
    super::window::park_reward(app);
    if let Ok(mut pending) = app.state::<AppState>().pending_relic_rewards.lock() {
        *pending = None;
    }
    let _ = app.emit(events::RELIC_REWARDS, serde_json::Value::Null);
}

/// Takes the last reward cards sent to the overlay. The overlay asks on
/// mount, so cards sent before it listened are not lost
/// (`src/frontend/src/screens/overlays/RelicRewardOverlay.tsx`).
#[tauri::command]
pub(crate) fn get_pending_relic_rewards(
    state: tauri::State<'_, AppState>,
) -> Option<serde_json::Value> {
    state.pending_relic_rewards.lock().ok()?.take()
}

#[cfg(test)]
mod tests {
    use super::*;
    use hexdesk_overlays::read::reward::{CardCount, Columns, MatchedBy, RewardRead};
    use std::sync::Arc;
    use tracing_subscriber::layer::SubscriberExt;

    #[test]
    fn reward_title_watcher_needs_three_consecutive_misses() {
        let mut misses = 0;
        assert_eq!(
            title_watch_decision(None, &mut misses),
            TitleWatchDecision::Continue
        );
        assert_eq!(
            title_watch_decision(None, &mut misses),
            TitleWatchDecision::Continue
        );
        assert_eq!(misses, 2);

        assert_eq!(
            title_watch_decision(Some(Screen::RewardChoice), &mut misses),
            TitleWatchDecision::Continue
        );
        assert_eq!(misses, 0, "seeing the reward title resets the streak");

        assert_eq!(
            title_watch_decision(None, &mut misses),
            TitleWatchDecision::Continue
        );
        assert_eq!(
            title_watch_decision(None, &mut misses),
            TitleWatchDecision::Continue
        );
        assert_eq!(
            title_watch_decision(None, &mut misses),
            TitleWatchDecision::Report(None)
        );
    }

    #[test]
    fn reward_title_watcher_reports_another_screen_immediately() {
        let mut misses = 0;
        assert_eq!(
            title_watch_decision(Some(Screen::RelicSelection), &mut misses),
            TitleWatchDecision::Report(Some(Screen::RelicSelection))
        );
    }

    fn logged(f: impl FnOnce()) -> Vec<hexdesk_diag::Entry> {
        let collector = Arc::new(hexdesk_diag::Collector::new(hexdesk_diag::Config::default()));
        let subscriber =
            tracing_subscriber::registry().with(hexdesk_diag::DiagLayer::new(collector.clone()));
        tracing::subscriber::with_default(subscriber, f);
        collector.recent(10)
    }

    #[test]
    fn a_missing_game_window_is_logged_as_a_relic_reward_error() {
        let entries = logged(|| log_attempt(3, 1200, None));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].code.as_deref(), Some("relic_reward.not_found"));
    }

    #[test]
    fn each_attempt_logs_every_card_with_its_match() {
        let card = |text: &str, name: Option<&str>, sure: bool| RewardCard {
            x: 0.4,
            text: text.into(),
            item: name.map(|n| format!("/Lotus/{n}")),
            name: name.map(str::to_string),
            score: if name.is_some() { 0.9 } else { 0.2 },
            alternatives: vec![("Ash Prime Chassis Blueprint".into(), 0.63)],
            matched_by: if name.is_some() {
                MatchedBy::Text
            } else {
                MatchedBy::None
            },
            sure,
        };
        let captured = RewardCapture {
            screen: Ok(RewardScreen::Cards(RewardRead {
                cards: vec![
                    card(
                        "Ash Prime Systems",
                        Some("Ash Prime Systems Blueprint"),
                        false,
                    ),
                    card("smudge", None, false),
                ],
                expected: 2,
                expected_from: CardCount::EeLog,
                columns: Columns::Bars,
                bars: "2 bars".into(),
                lines: Vec::new(),
            })),
            info: "test".into(),
            saved: None,
            capture_ms: 30,
            ocr_ms: 120,
        };
        let entries = logged(|| log_attempt(2, 850, Some(&captured)));
        let field = |message: &str, n: usize, k: &str| {
            entries
                .iter()
                .filter(|e| e.message == message)
                .nth(n)
                .and_then(|e| e.fields.iter().find(|(key, _)| key == k))
                .map(|(_, v)| v.clone())
        };
        let attempt = "OCR attempt read reward cards";
        assert_eq!(
            field(attempt, 0, "since_trigger_ms").as_deref(),
            Some("850")
        );
        assert_eq!(field(attempt, 0, "ocr_ms").as_deref(), Some("120"));
        assert_eq!(field(attempt, 0, "matched").as_deref(), Some("1"));
        assert_eq!(
            field(attempt, 0, "expected_from").as_deref(),
            Some("EE.log")
        );
        assert_eq!(
            field("Reward card", 0, "item").as_deref(),
            Some("Ash Prime Systems Blueprint")
        );
        assert_eq!(field("Reward card", 0, "sure").as_deref(), Some("false"));
        assert_eq!(
            field("Reward card", 0, "next_best").as_deref(),
            Some("Ash Prime Chassis Blueprint 0.63")
        );
        assert_eq!(field("Reward card", 1, "item").as_deref(), Some("none"));
        assert_eq!(field("Reward card", 1, "text").as_deref(), Some("smudge"));
    }

    #[test]
    fn an_uncertain_card_is_marked_for_the_overlay() {
        let cards = [
            ShownCard {
                item: Some("/Lotus/Lex".into()),
                text: "Lex Prime".into(),
                x: 0.4,
                sure: false,
            },
            ShownCard {
                item: None,
                text: "smudge".into(),
                x: 0.6,
                sure: false,
            },
        ];
        assert_eq!(
            payload(&cards),
            serde_json::json!({
                "items": ["/Lotus/Lex", "?:smudge"],
                "positions": [0.4f32, 0.6f32],
                "uncertain": [true, false],
            })
        );
    }
}
