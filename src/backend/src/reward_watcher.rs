use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Emitter;

use crate::events;
use crate::log_watcher;
use crate::overlays;
use crate::wfcd::RelicReward;

/// Shared state for the reward watcher thread.
pub(crate) struct RewardWatcherDeps {
    pub app: tauri::AppHandle,
    pub flag: Arc<AtomicBool>,
    pub relic_rewards: HashMap<String, Vec<RelicReward>>,
}

/// Spawn the single EE.log tailer thread, started once at app startup and running
/// for the app's lifetime — independent of the memory scanner's on/off state.
///
/// This thread:
/// - Tails EE.log using FindFirstChangeNotificationW for instant wake-up
/// - Sends the lines that open and close the relic, reward and riven screens to
///   the overlay runtime, and handles trade completion and WFM whisper
///   detection unconditionally (plain file I/O, not memory reading)
/// - Collects squad member names, the squad size and session relics for the
///   reward card read, which runs only while `deps.flag` (the memory
///   scanner's `monitor_active` state) is true
/// - Updates the inventory from the rewards EE.log reports
pub(crate) fn spawn_reward_watcher_thread(deps: RewardWatcherDeps) {
    let RewardWatcherDeps {
        app,
        flag,
        relic_rewards,
    } = deps;

    // Build OCR catalog from relic rewards
    let catalog_pairs = build_relic_reward_catalog(&relic_rewards);
    let catalog_pairs = Arc::new(catalog_pairs);

    let ee_log_path = hexdesk_platform::game_paths::ee_log();

    // Shared squad size: updated by EE.log watcher when VoidProjections sequence
    // completes, read by OCR loop for each attempt. This lets late-arriving squad
    // data (VoidProjections often arrives 1-2 s after the screen opens) inform
    // subsequent OCR retries so the card count is always correct.
    let shared_squad_size: Arc<Mutex<Option<usize>>> = Arc::new(Mutex::new(None));
    let shared_squad_size2 = Arc::clone(&shared_squad_size);

    // Squad member names collected from EE.log "AddSquadMember:" lines.
    // Passed to OCR so it can reject any text that fuzzy-matches a player name.
    let shared_squad_names: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let shared_squad_names2 = Arc::clone(&shared_squad_names);

    let ee_ocr_app = app.clone();
    overlays::reward::set_context(overlays::reward::RewardContext {
        session_relics: Mutex::new(Vec::new()),
        squad_size: Arc::clone(&shared_squad_size),
        squad_names: Arc::clone(&shared_squad_names),
        catalog: Arc::clone(&catalog_pairs),
        scanner_on: flag.clone(),
    });

    if let Some(log_path) = ee_log_path {
        std::thread::spawn(move || {
            let mut file_pos: u64 = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
            // Last time a poll actually read new (non-empty) EE.log content.
            // Drives the fast/slow poll cadence below — recent game activity
            // means more triggers (riven, trade, relic-pick, reward) could be
            // seconds away, so every event type benefits from fast polling,
            // not just an already-open reward screen.
            let mut last_log_activity: Option<std::time::Instant> = None;
            const LOG_ACTIVITY_WINDOW: std::time::Duration = std::time::Duration::from_secs(5);
            // Rolling raw log text used to reconstruct multi-read trade dialogs.
            let mut trade_buffer = String::new();
            // Trailing partial-line buffer: a marker split across two reads by a
            // mid-write wake-up (e.g. a relic resource-load or dismiss line
            // half-flushed) must never be tested half-formed by the
            // `.contains()`/`.lines()` detectors below — a split "Resource load
            // completed" line silently drops that relic from session_relics.
            // Capped so a stalled or pathologically long line can't grow forever.
            let mut line_carry = String::new();
            const MAX_LINE_CARRY_BYTES: usize = 64 * 1024;
            use std::io::{Read, Seek, SeekFrom};

            log_watcher::seed_ee_log_names(&log_path, &shared_squad_names2, &ee_ocr_app);
            // EE.log line times are seconds since this start time.
            let mut ee_log_start = read_ee_log_start(&log_path);

            // ── VoidProjections reward sequence state ─────────────────────────
            // The game logs squad reward info BEFORE the screen trigger fires.
            // We accumulate it across poll iterations so it's ready when OCR starts.
            let mut vp_state = log_watcher::VoidProjectionState::default();
            // ── Relic prefilter ───────────────────────────────────────────────────
            // Projection paths collected from "Resource load completed" EE.log lines
            // while squad loadouts download. Used at trigger time to narrow the OCR
            // candidate list from ~700 items to the ~6-24 rewards of the active relics.
            let mut session_relics: Vec<String> = Vec::new();
            // Catch up relics already loaded this mission before this thread
            // started (e.g. HexDesk launched mid-mission) — otherwise the
            // live tailer below, which only reads forward from file_pos, would
            // never see those earlier "Resource load completed" lines.
            log_watcher::seed_session_relics(&log_path, &mut session_relics);
            overlays::reward::set_session_relics(&session_relics);

            // Wake the instant EE.log is written to disk instead of sleeping
            // 200 ms between checks.
            let dir_watch = hexdesk_platform::dir_watch::DirWatch::new(
                log_path.parent().unwrap_or(std::path::Path::new(".")),
            );

            loop {
                // Poll fast (50 ms) whenever a reward screen is up OR the log has
                // written something within the last few seconds — active gameplay
                // means a riven unveil, trade, relic-pick, or reward trigger could
                // land any moment, and all of those benefit from fast detection,
                // not just an already-open reward screen. Falls back to a slow
                // 500 ms idle poll once the log (and thus the game) has been quiet.
                let reward_active = overlays::reward_shown();
                let log_recently_active =
                    last_log_activity.is_some_and(|t| t.elapsed() < LOG_ACTIVITY_WINDOW);
                let idle_wait_ms: u32 = if reward_active || log_recently_active {
                    50
                } else {
                    500
                };
                if let Some(watch) = &dir_watch {
                    // Block until a write lands in the EE.log directory (the timeout keeps
                    // the flag check alive even when the game isn't writing).
                    watch.wait(std::time::Duration::from_millis(u64::from(idle_wait_ms)));
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(
                        idle_wait_ms.min(200) as u64
                    ));
                }
                let Ok(mut f) = std::fs::File::open(&log_path) else {
                    continue;
                };
                let len = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
                if len < file_pos {
                    file_pos = 0;
                    // Log rotated/truncated — any carried fragment is from a
                    // different file and must not be glued onto the new one.
                    line_carry.clear();
                }
                if f.seek(SeekFrom::Start(file_pos)).is_err() {
                    continue;
                }
                let mut raw = String::new();
                if f.read_to_string(&mut raw).is_err() {
                    continue;
                }
                file_pos = len;
                if raw.is_empty() {
                    continue;
                }
                if !raw.is_empty() {
                    last_log_activity = Some(std::time::Instant::now());
                }

                line_carry.push_str(&raw);
                if line_carry.len() > MAX_LINE_CARRY_BYTES {
                    let mut cut = line_carry.len() - MAX_LINE_CARRY_BYTES;
                    while cut < line_carry.len() && !line_carry.is_char_boundary(cut) {
                        cut += 1;
                    }
                    line_carry.drain(..cut);
                }
                // Hand the detectors below only complete lines; a line still being
                // written by the game sits in line_carry until the next wake-up.
                let buf: String = match line_carry.rfind('\n') {
                    Some(split_at) => line_carry.drain(..=split_at).collect(),
                    None => continue,
                };

                let lower = buf.to_lowercase();

                log_watcher::collect_void_projection_state(
                    &buf,
                    &mut vp_state,
                    &shared_squad_size2,
                );

                // Relics are announced before the reward screen opens, narrowing OCR candidates.
                log_watcher::collect_session_relics(&buf, &mut session_relics);
                overlays::reward::set_session_relics(&session_relics);

                // AddSquadMember, avatar changes and local login all feed the OCR filter.
                log_watcher::collect_ee_log_names(&buf, &shared_squad_names2, &ee_ocr_app);

                // ── WFM trade whisper detection ──────────────────────────────────
                if lower.contains("(warframe.market)") {
                    log_watcher::parse_and_emit_wfm_whisper(&ee_ocr_app, &buf);
                }

                if let Some(start) = hexdesk_overlays::ee_log::log_start(&buf) {
                    ee_log_start = Some(start);
                }
                send_screen_signals(&buf, ee_log_start);
                log_watcher::handle_trade_completion(&ee_ocr_app, &buf, &mut trade_buffer);

                // Unveil: riven challenge completion
                if lower.contains("modreveal")
                    || (lower.contains("riven") && lower.contains("unveiled"))
                {
                    let _ = ee_ocr_app.emit(events::RIVEN_UNVEILED, ());
                }

                // When the reward screen closes, the local player's reward
                // goes into the inventory; a session end forgets the relics of
                // the session. Endless missions reuse their relics across
                // rotations without logging them again, so they are kept
                // until then.
                let closed = lower.contains("relic reward screen shut down")
                    || lower.contains("closevoidprojectionrewardscreen")
                    || lower.contains("matchingservice::endsession");
                if closed {
                    if let Some(store_path) = vp_state.take_own_item() {
                        log_watcher::apply_reward_inventory_update(&ee_ocr_app, store_path);
                    }
                    if lower.contains("matchingservice::endsession") {
                        session_relics.clear();
                        overlays::reward::set_session_relics(&session_relics);
                    }
                }
            }
        });
    }
}

/// The start time in the head of EE.log, if the file has one.
fn read_ee_log_start(log_path: &std::path::Path) -> Option<hexdesk_overlays::Millis> {
    use std::io::Read;
    let mut head = vec![0u8; 8 * 1024];
    let n = std::fs::File::open(log_path)
        .and_then(|mut f| f.read(&mut head))
        .ok()?;
    hexdesk_overlays::ee_log::log_start(&String::from_utf8_lossy(&head[..n]))
}

/// Sends the screen events in a piece of EE.log to the overlay runtime, each
/// with the time the game wrote it. Without a known log start, the time they
/// were read stands in.
fn send_screen_signals(text: &str, log_start: Option<hexdesk_overlays::Millis>) {
    let signals: Vec<hexdesk_overlays::Signal> = hexdesk_overlays::ee_log::parse_text(text)
        .into_iter()
        .map(|line| {
            let at = log_start.map_or_else(overlays::now, |start| line.time(start));
            hexdesk_overlays::Signal::log(at, line.event)
        })
        .collect();
    if !signals.is_empty() {
        overlays::send(overlays::Input::Signals(signals));
    }
}

/// Build the OCR catalog from relic rewards.
/// Two keys per relic (uniqueName + display name); dedup by unique_name.
fn build_relic_reward_catalog(
    relic_rewards: &HashMap<String, Vec<RelicReward>>,
) -> Vec<(String, String)> {
    let mut catalog_pairs: Vec<(String, String)> = relic_rewards
        .values()
        .flat_map(|rewards| rewards.iter())
        .filter(|r| !r.name.is_empty())
        .map(|r| (r.unique_name.clone(), r.name.clone()))
        .collect();
    catalog_pairs.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    catalog_pairs.dedup_by(|a, b| !a.0.is_empty() && a.0 == b.0);
    catalog_pairs
}
