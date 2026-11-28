use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};

use hexdesk_diag::{debug, info, DiagError, Kind, Level, Source};
use tauri::{Emitter, Manager};

use crate::app_state::AppState;
use crate::catalogue;
use crate::db;
use crate::events;
use crate::inventory_state::{build_inventory_from_blob, load_inventory_state_cache};
use crate::memory_scanner;
use crate::monitor::{self, BlobStatusPayload, InventoryUpdate};
use crate::BlobBuildParams;
use hexdesk_persist::atomic_write;

/// Shared state needed by the blob capture thread, extracted from AppState
/// to keep the clone list at the spawn site manageable.
pub(crate) struct BlobCaptureDeps {
    pub app: tauri::AppHandle,
    pub flag: Arc<AtomicBool>,
    pub db_path: std::path::PathBuf,
    pub inventory_state_cache_path: std::path::PathBuf,
    pub shared_quantities: Arc<Mutex<HashMap<String, i64>>>,
    pub shared_unique: Arc<Mutex<HashMap<String, i64>>>,
    pub shared_mods: Arc<Mutex<HashMap<String, hexdesk_blob::ModCount>>>,
    pub shared_crafting: Arc<Mutex<Vec<monitor::CraftingJob>>>,
    pub force_pid_check: Arc<AtomicBool>,
    pub blob_rx: Receiver<hexdesk_blob::BlobRead>,
    pub blob_tx: Sender<hexdesk_blob::BlobRead>,
}

/// Spawn the blob-capture thread.
///
/// This thread is responsible for:
/// - Detecting whether Warframe is running (PID check every 5s)
/// - Capturing memory blobs every 10s when the game is active
/// - Processing incoming blobs via the channel and updating shared state
/// - Emitting inventory-update events to the UI
pub(crate) fn spawn_blob_capture_thread(deps: BlobCaptureDeps, catalog: monitor::MonitorCatalog) {
    let BlobCaptureDeps {
        app,
        flag,
        db_path,
        inventory_state_cache_path,
        shared_quantities,
        shared_unique,
        shared_mods,
        shared_crafting,
        force_pid_check,
        blob_rx,
        blob_tx,
    } = deps;

    let monitor::MonitorCatalog {
        path_to_name,
        path_to_ducat,
        path_to_vaulted,
        path_to_tradable,
        path_to_masterable,
        path_to_category,
        alias_excluded,
        ignored_paths,
        stackable_paths,
        path_aliases,
        unique_names,
        display_names,
        relic_drops_snapshot,
    } = catalog;

    std::thread::spawn(move || {
        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                let _ = DiagError::new(
                    Source::Scanner,
                    Kind::Io,
                    "Inventory scanning stopped: the inventory database could not be opened",
                )
                .caused_by(&e)
                .log_at(Level::Error);
                return;
            }
        };
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

        for name in STALE_CACHE_FILES {
            let _ = std::fs::remove_file(inventory_state_cache_path.with_file_name(name));
        }
        let scan_state_path = scan_state_path(&inventory_state_cache_path);
        let mut scan_state = load_scan_state(&scan_state_path);
        let mut last_unread_keys: Vec<String> = Vec::new();

        let startup = monitor::init_monitor_startup_state(
            &shared_quantities,
            &shared_mods,
            &inventory_state_cache_path,
        );
        let mut known = startup.known;
        let mut prev_mods = startup.prev_mods;
        let mut unique_stable = startup.unique_stable;
        let mut confirmed_unique = startup.confirmed_unique;
        let mut known_mods = startup.known_mods;
        let mut last_snapshot_date = String::new();

        // Emit an immediate status before the first scan so the UI shows cached
        // inventory data without waiting for the scan to finish.
        {
            let game_found = memory_scanner::find_warframe_pid_pub().is_some();
            let now_pre = jiff::Timestamp::now().as_second();
            let mut initial_qty = known.clone();
            for k in unique_stable.keys() {
                initial_qty.entry(k.clone()).or_insert(1);
            }
            for (path, mc) in &known_mods {
                initial_qty.entry(path.clone()).or_insert(mc.total);
            }
            let _ = app.emit(
                events::INVENTORY_UPDATE,
                InventoryUpdate {
                    quantities: initial_qty,
                    crafting: vec![],
                    mastery_rank: startup.current_mastery_rank,
                    mastery_data: startup.current_mastery_data.clone(),
                    changes: vec![],
                    consumed_suits: startup.current_consumed_suits.clone(),
                    mods: known_mods.clone(),
                    socketed_shards: startup.current_socketed_shards.clone(),
                    forma_counts: startup.current_forma_counts.clone(),
                    warframe_running: game_found,
                    scanned_at: now_pre,
                    is_full_pass: true,
                    player_name: app
                        .state::<AppState>()
                        .local_player_name
                        .lock()
                        .ok()
                        .and_then(|g| g.clone()),
                },
            );
        }

        let mut current_mastery_rank = startup.current_mastery_rank;
        let mut current_mastery_data = startup.current_mastery_data;
        let mut current_recipes: Vec<memory_scanner::PendingRecipe> = Vec::new();
        let mut current_consumed_suits = startup.current_consumed_suits;
        let mut current_socketed_shards = startup.current_socketed_shards;
        let mut current_forma_counts = startup.current_forma_counts;
        let mut last_blob_time: Option<std::time::Instant> = None;
        // Guard against overlapping captures: a full memory walk can take >10 s on large
        // game processes, so without this flag we'd stack up concurrent scan threads.
        let blob_scan_active = Arc::new(AtomicBool::new(false));
        // Cache the game-running state so we only re-enumerate processes once every 5 s
        // instead of on every 2-second loop tick (CreateToolhelp32Snapshot is not free).
        let mut last_pid_check: Option<std::time::Instant> = None;
        let mut last_pid: Option<u32> = None;
        let mut cached_game_running = false;
        // Hysteresis against flapping: mark "running" on a single hit, only
        // mark "not running" after 2 consecutive misses (2x 5 s). A poke_scan
        // (forced) bypasses the hysteresis for an immediate result.
        let mut consecutive_misses: u32 = 0;
        // When game is not running, suppress redundant inventory-update emits.
        // Only emit on the status-change tick and then at most once every 30 s as a heartbeat.
        let mut prev_game_running = false;
        let mut last_not_running_emit: Option<std::time::Instant> = None;

        while flag.load(Ordering::SeqCst) {
            // If shared_quantities was cleared externally (clear_cache command), wipe local
            // state so the next blob logs everything as fresh.
            {
                let sq = shared_quantities.lock().unwrap_or_else(|e| e.into_inner());
                let local_has_data =
                    !known.is_empty() || !unique_stable.is_empty() || !known_mods.is_empty();
                if sq.is_empty() && local_has_data {
                    known.clear();
                    unique_stable.clear();
                    confirmed_unique.clear();
                    known_mods.clear();
                    scan_state = hexdesk_player::ScanState::default();
                }
            }

            let now = jiff::Timestamp::now().as_second();

            // Process any incoming blob (non-blocking)
            while let Ok(read) = blob_rx.try_recv() {
                let outcome = scan_state.apply(&read, jiff::Timestamp::now().as_millisecond());
                log_scan_outcome(&read, &outcome, &mut last_unread_keys);
                if !outcome.changed() {
                    debug!(scanner, "Account blob unchanged since the last one");
                    continue;
                }
                let blob = scan_state.to_inventory();

                process_blob(
                    &blob,
                    &app,
                    &conn,
                    &inventory_state_cache_path,
                    &path_to_name,
                    &path_to_category,
                    &path_to_ducat,
                    &path_to_vaulted,
                    &path_to_tradable,
                    &path_to_masterable,
                    &relic_drops_snapshot,
                    &alias_excluded,
                    &stackable_paths,
                    &path_aliases,
                    &ignored_paths,
                    &shared_quantities,
                    &shared_mods,
                    &shared_unique,
                    &shared_crafting,
                    &mut known,
                    &mut prev_mods,
                    &mut unique_stable,
                    &mut confirmed_unique,
                    &mut known_mods,
                    &mut current_mastery_rank,
                    &mut current_mastery_data,
                    &mut current_recipes,
                    &mut current_consumed_suits,
                    &mut current_socketed_shards,
                    &mut current_forma_counts,
                    &mut last_snapshot_date,
                    now,
                );
                save_scan_state(&scan_state_path, &scan_state);
            }

            // Re-enumerate processes at most every 5 s (CreateToolhelp32Snapshot overhead).
            // force_pid_check bypasses the cooldown (set by the poke_scan command).
            let forced = force_pid_check.swap(false, Ordering::SeqCst);
            let needs_pid_check = forced
                || last_pid_check.is_none_or(|t: std::time::Instant| t.elapsed().as_secs() >= 5);
            if needs_pid_check {
                let current_pid = memory_scanner::find_warframe_pid_pub();
                if current_pid.is_some() {
                    consecutive_misses = 0;
                    cached_game_running = true;
                } else if forced {
                    consecutive_misses = 0;
                    cached_game_running = false;
                } else {
                    consecutive_misses += 1;
                    if consecutive_misses >= 2 {
                        cached_game_running = false;
                    }
                }
                if current_pid != last_pid {
                    match current_pid {
                        Some(pid) => {
                            info!(
                                scanner,
                                pid,
                                previous_pid = ?last_pid,
                                hexdesk_elevated = memory_scanner::elevated_text(),
                                "Warframe process found"
                            );
                            memory_scanner::reset_last_blob_region();
                        }
                        None => {
                            info!(scanner, previous_pid = ?last_pid, "Warframe process no longer running");
                        }
                    }
                    last_pid = current_pid;
                }
                last_pid_check = Some(std::time::Instant::now());
            }
            let game_running = cached_game_running;
            // Detection is decoupled from blob success: as soon as the PID exists
            // the UI knows the game is running — even while the memory scan is
            // still in flight or failing. Without this the chip stayed on
            // "No Game" until a blob parse succeeded, which explains the
            // sporadic recognition.
            if game_running && !prev_game_running {
                let mut emit_qty = known.clone();
                for k in &confirmed_unique {
                    emit_qty.entry(k.clone()).or_insert(1);
                }
                for (p, mc) in &known_mods {
                    emit_qty.entry(p.clone()).or_insert(mc.total);
                }
                let crafting = monitor::build_crafting_jobs(
                    &current_recipes
                        .iter()
                        .map(|r| (r.unique_name.clone(), r.completion_ms))
                        .collect::<Vec<_>>(),
                    &display_names,
                    &unique_names,
                );
                let _ = app.emit(
                    events::INVENTORY_UPDATE,
                    InventoryUpdate {
                        quantities: emit_qty,
                        crafting,
                        mastery_rank: current_mastery_rank,
                        mastery_data: HashMap::new(),
                        changes: vec![],
                        warframe_running: true,
                        scanned_at: now,
                        consumed_suits: current_consumed_suits.clone(),
                        mods: known_mods.clone(),
                        socketed_shards: current_socketed_shards.clone(),
                        forma_counts: current_forma_counts.clone(),
                        is_full_pass: false,
                        player_name: app
                            .state::<AppState>()
                            .local_player_name
                            .lock()
                            .ok()
                            .and_then(|g| g.clone()),
                    },
                );
            }
            if game_running {
                // ── Blob capture: unconditional scan every 10 seconds ─────────
                let should_capture = last_blob_time.is_none_or(|t: std::time::Instant| {
                    t.elapsed() >= std::time::Duration::from_secs(10)
                });
                let already_running = blob_scan_active.load(Ordering::SeqCst);

                if should_capture && !already_running {
                    blob_scan_active.store(true, Ordering::SeqCst);
                    last_blob_time = Some(std::time::Instant::now());
                    let active = blob_scan_active.clone();
                    let tx = blob_tx.clone();
                    let _ = app.emit(
                        events::BLOB_STATUS,
                        BlobStatusPayload {
                            stage: "scanning".into(),
                            detail: "Reading Warframe memory\u{2026}".into(),
                        },
                    );
                    std::thread::spawn(move || {
                        struct ClearOnDrop(Arc<AtomicBool>);
                        impl Drop for ClearOnDrop {
                            fn drop(&mut self) {
                                self.0.store(false, Ordering::SeqCst);
                            }
                        }
                        let _guard = ClearOnDrop(active);
                        let _op = hexdesk_diag::op!(scanner, "Inventory scan").entered();
                        if let Err(e) = memory_scanner::capture_all_blobs(tx) {
                            let _ = e.log();
                        }
                    });
                }
                prev_game_running = true;
            } else {
                // Game not running — throttle emits: only on status-change and every 30 s heartbeat.
                // Without this guard the loop emits every 2 s with identical data, triggering a
                // full React render cascade (17 k-item useMemo rebuild) 30 times per minute.
                let status_changed = prev_game_running;
                let heartbeat_due = last_not_running_emit.is_none_or(|t: std::time::Instant| {
                    t.elapsed() >= std::time::Duration::from_secs(30)
                });
                if status_changed || heartbeat_due {
                    let mut emit_qty = known.clone();
                    for k in &confirmed_unique {
                        emit_qty.entry(k.clone()).or_insert(1);
                    }
                    for (p, mc) in &known_mods {
                        emit_qty.entry(p.clone()).or_insert(mc.total);
                    }
                    let crafting = monitor::build_crafting_jobs(
                        &current_recipes
                            .iter()
                            .map(|r| (r.unique_name.clone(), r.completion_ms))
                            .collect::<Vec<_>>(),
                        &display_names,
                        &unique_names,
                    );
                    // Skip mastery_data on heartbeats — it hasn't changed and spreading 17k
                    // entries into React state on every tick is expensive.
                    let send_mastery = status_changed;
                    let _ = app.emit(
                        events::INVENTORY_UPDATE,
                        InventoryUpdate {
                            quantities: emit_qty,
                            crafting,
                            mastery_rank: current_mastery_rank,
                            mastery_data: if send_mastery {
                                current_mastery_data.clone()
                            } else {
                                HashMap::new()
                            },
                            changes: vec![],
                            warframe_running: false,
                            scanned_at: now,
                            consumed_suits: current_consumed_suits.clone(),
                            mods: known_mods.clone(),
                            socketed_shards: current_socketed_shards.clone(),
                            forma_counts: current_forma_counts.clone(),
                            is_full_pass: false,
                            player_name: app
                                .state::<AppState>()
                                .local_player_name
                                .lock()
                                .ok()
                                .and_then(|g| g.clone()),
                        },
                    );
                    last_not_running_emit = Some(std::time::Instant::now());
                }
                prev_game_running = false;
            }

            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn process_blob(
    blob: &hexdesk_blob::BlobInventory,
    app: &tauri::AppHandle,
    conn: &rusqlite::Connection,
    inventory_state_cache_path: &std::path::Path,
    path_to_name: &HashMap<String, String>,
    path_to_category: &HashMap<String, String>,
    path_to_ducat: &HashMap<String, u32>,
    path_to_vaulted: &HashMap<String, bool>,
    path_to_tradable: &HashMap<String, bool>,
    path_to_masterable: &HashMap<String, bool>,
    relic_drops_snapshot: &HashMap<String, Vec<String>>,
    alias_excluded: &std::collections::HashSet<String>,
    stackable_paths: &std::collections::HashSet<String>,
    path_aliases: &HashMap<String, String>,
    ignored_paths: &std::collections::HashSet<String>,
    shared_quantities: &Arc<Mutex<HashMap<String, i64>>>,
    shared_mods: &Arc<Mutex<HashMap<String, hexdesk_blob::ModCount>>>,
    shared_unique: &Arc<Mutex<HashMap<String, i64>>>,
    shared_crafting: &Arc<Mutex<Vec<monitor::CraftingJob>>>,
    known: &mut HashMap<String, i64>,
    prev_mods: &mut HashMap<String, hexdesk_blob::ModCount>,
    unique_stable: &mut HashMap<String, u8>,
    confirmed_unique: &mut std::collections::HashSet<String>,
    known_mods: &mut HashMap<String, hexdesk_blob::ModCount>,
    current_mastery_rank: &mut Option<u32>,
    current_mastery_data: &mut HashMap<String, u32>,
    current_recipes: &mut Vec<memory_scanner::PendingRecipe>,
    current_consumed_suits: &mut Vec<String>,
    current_socketed_shards: &mut HashMap<String, Vec<hexdesk_blob::ArchonShard>>,
    current_forma_counts: &mut HashMap<String, u32>,
    last_snapshot_date: &mut String,
    now: i64,
) {
    let existing_wfm: HashMap<String, u32> =
        load_inventory_state_cache(&inventory_state_cache_path.to_path_buf())
            .items
            .into_iter()
            .filter_map(|(k, v)| v.wfm_price.map(|p| (k, p)))
            .collect();
    let sc = build_inventory_from_blob(BlobBuildParams {
        blob,
        path_to_name,
        path_to_category,
        path_to_ducat,
        path_to_vaulted,
        path_to_tradable,
        path_to_masterable,
        relic_drops: relic_drops_snapshot,
        existing_wfm_prices: &existing_wfm,
        excluded_paths: alias_excluded,
        stackable_paths,
    });
    if let Ok(json) = serde_json::to_string(&sc) {
        let _ = atomic_write(inventory_state_cache_path, json.as_bytes());
    }

    // Snapshot previous full inventory (known + uniques + mods) for change detection.
    let prev_all: HashMap<String, i64> = {
        let mut m = known.clone();
        for k in confirmed_unique.iter() {
            m.entry(k.clone()).or_insert(1);
        }
        for (p, mc) in known_mods.iter() {
            m.entry(p.clone()).or_insert(mc.total);
        }
        m
    };

    // `blob` is the merged state of every section, so it replaces the
    // previous inventory as a whole.
    {
        let mut inv_state = monitor::InventoryState {
            known,
            unique_stable,
            confirmed_unique,
            known_mods,
            current_socketed_shards,
            current_forma_counts,
            current_mastery_rank,
            current_mastery_data,
            current_consumed_suits,
            current_recipes,
        };
        monitor::apply_blob_to_state(blob, &mut inv_state, path_aliases, stackable_paths);
    }

    catalogue::log_unmatched_paths(blob, path_to_name, path_to_category, ignored_paths);

    // Sync shared state
    if let Ok(mut q) = shared_quantities.lock() {
        *q = known.clone();
    }
    crate::player::scan_applied();
    if let Ok(mut sm) = shared_mods.lock() {
        *sm = known_mods.clone();
    }
    if let Ok(mut uq) = shared_unique.lock() {
        uq.clear();
        for name in confirmed_unique.iter() {
            uq.insert(name.clone(), 1);
        }
    }

    // Emit inventory update
    let mut emit_qty = known.clone();
    for k in confirmed_unique.iter() {
        emit_qty.entry(k.clone()).or_insert(1);
    }
    for (p, mc) in known_mods.iter() {
        emit_qty.entry(p.clone()).or_insert(mc.total);
    }

    // Detect and record every quantity change (up, down, new, gone-to-0).
    let mut changes =
        db::detect_quantity_changes(conn, &prev_all, &emit_qty, ignored_paths, path_to_name);

    // Rank-specific change detection for mods/arcanes.
    {
        let rank_changes =
            db::detect_mod_rank_changes(conn, prev_mods, known_mods, ignored_paths, path_to_name);
        changes.extend(rank_changes);
    }
    // Update prev_mods for next iteration
    *prev_mods = known_mods.clone();

    let crafting = monitor::build_crafting_jobs(
        &blob
            .pending_recipes
            .iter()
            .map(|r| (r.item_type.clone(), r.completion_ms))
            .collect::<Vec<_>>(),
        &[], // display_names not needed here — already in path_to_name
        &[], // unique_names not needed here
    );
    *shared_crafting.lock().unwrap_or_else(|e| e.into_inner()) = crafting.clone();
    let _ = app.emit(
        events::INVENTORY_UPDATE,
        InventoryUpdate {
            quantities: emit_qty,
            crafting,
            mastery_rank: *current_mastery_rank,
            mastery_data: current_mastery_data.clone(),
            changes,
            warframe_running: true,
            scanned_at: now,
            consumed_suits: current_consumed_suits.clone(),
            mods: known_mods.clone(),
            socketed_shards: current_socketed_shards.clone(),
            forma_counts: current_forma_counts.clone(),
            is_full_pass: true,
            player_name: app
                .state::<AppState>()
                .local_player_name
                .lock()
                .ok()
                .and_then(|g| g.clone()),
        },
    );
    let detail = format!(
        "{} unique · {} resources · {} mods · {} flavour",
        blob.unique_items.len(),
        blob.stackable_items.len(),
        blob.mods.len(),
        blob.flavour_items.len()
    );
    info!(
        scanner,
        unique = blob.unique_items.len(),
        resources = blob.stackable_items.len(),
        mods = blob.mods.len(),
        flavour = blob.flavour_items.len(),
        "Inventory updated from account blob"
    );
    let _ = app.emit(
        events::BLOB_STATUS,
        BlobStatusPayload {
            stage: "done".into(),
            detail,
        },
    );

    // Daily snapshots
    let today = jiff::Timestamp::now().strftime("%Y-%m-%d").to_string();
    if *last_snapshot_date != today {
        *last_snapshot_date = today.clone();
        if let Ok(tracked) = db::get_tracked_items(conn) {
            for item in &tracked {
                let qty = *known.get(&item.unique_name).unwrap_or(&0);
                let _ = db::record_snapshot(conn, &item.unique_name, &today, qty);
            }
        }
    }
}

/// Cache files this version does not read. They are removed at start so they
/// do not linger in the cache folder.
const STALE_CACHE_FILES: &[&str] = &["section_baseline.json"];

/// Where the inventory per section is saved, next to the inventory cache.
pub(crate) fn scan_state_path(inventory_state_cache_path: &std::path::Path) -> std::path::PathBuf {
    inventory_state_cache_path.with_file_name("scan_sections.json")
}

/// The inventory per section as it was saved, or an empty one when nothing
/// was saved or the file could not be read.
fn load_scan_state(path: &std::path::Path) -> hexdesk_player::ScanState {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return hexdesk_player::ScanState::default();
        }
        Err(e) => {
            let _ = DiagError::new(
                Source::Scanner,
                Kind::Io,
                "Saved inventory sections could not be read: the next scan starts from nothing",
            )
            .caused_by(&e)
            .log();
            return hexdesk_player::ScanState::default();
        }
    };
    let saved = match serde_json::from_slice::<hexdesk_player::SavedScan>(&bytes) {
        Ok(saved) => saved,
        Err(e) => {
            let _ = DiagError::new(
                Source::Scanner,
                Kind::Parse,
                "Saved inventory sections could not be read: the next scan starts from nothing",
            )
            .caused_by(&e)
            .log();
            return hexdesk_player::ScanState::default();
        }
    };
    let (state, dropped) = hexdesk_player::ScanState::from_saved(saved);
    if !dropped.is_empty() {
        info!(
            scanner,
            sections = %dropped.join(","),
            "Saved inventory sections left out: not read by this version"
        );
    }
    state
}

fn save_scan_state(path: &std::path::Path, state: &hexdesk_player::ScanState) {
    let result = serde_json::to_vec(&state.to_saved())
        .map_err(|e| e.to_string())
        .and_then(|json| atomic_write(path, &json).map_err(|e| e.to_string()));
    if let Err(e) = result {
        let _ = DiagError::new(
            Source::Scanner,
            Kind::Io,
            "Inventory sections could not be saved: a restart starts from the last saved scan",
        )
        .with("cause", e)
        .log();
    }
}

/// Logs what a blob did per section: which were kept from an earlier scan and
/// why, which were taken as empty, and which top-level keys are not read.
fn log_scan_outcome(
    read: &hexdesk_blob::BlobRead,
    outcome: &hexdesk_player::ScanOutcome,
    last_unread_keys: &mut Vec<String>,
) {
    use hexdesk_player::SectionOutcome;

    let missing = outcome.named(|o| matches!(o, SectionOutcome::KeptMissing { .. }));
    let front_lost = outcome.named(|o| *o == SectionOutcome::KeptFrontLost);
    if !missing.is_empty() || !front_lost.is_empty() {
        debug!(
            scanner,
            missing = %missing.join(","),
            front_lost = %front_lost.join(","),
            "Account blob sections kept from an earlier scan: not in this blob"
        );
    }
    for (name, o) in &outcome.sections {
        if let SectionOutcome::KeptUnreadable { expected } = o {
            let _ = DiagError::new(
                Source::Scanner,
                Kind::Invalid,
                "Account blob section kept from an earlier scan: it has another shape",
            )
            .with("section", *name)
            .with("expected", *expected)
            .log();
        }
    }
    let emptied = outcome.named(|o| *o == SectionOutcome::Emptied);
    if !emptied.is_empty() {
        info!(
            scanner,
            sections = %emptied.join(","),
            blobs = hexdesk_player::EMPTY_AFTER,
            "Account blob sections taken as empty: missing from complete blobs in a row"
        );
    }

    let unread: Vec<String> = read.unread_keys().into_iter().map(String::from).collect();
    if unread != *last_unread_keys {
        debug!(
            scanner,
            keys = %unread.join(","),
            "Account blob sections that are not read"
        );
        *last_unread_keys = unread;
    }
}

#[cfg(test)]
mod scan_state_file_tests {
    use super::{load_scan_state, save_scan_state, scan_state_path};
    use hexdesk_blob::{
        BlobRead, BlobStackableEntry, SectionContent, SectionRead, SectionState, SECTIONS,
    };
    use hexdesk_player::ScanState;

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hexdesk-scan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state_with_alloy() -> ScanState {
        let read = BlobRead {
            sections: SECTIONS
                .iter()
                .map(|section| SectionRead {
                    section: *section,
                    state: if section.name == "MiscItems" {
                        SectionState::Read(SectionContent::Stackable(vec![BlobStackableEntry {
                            item_type: "/Lotus/Types/Items/MiscItems/Alloy".to_string(),
                            item_count: 100,
                            sockets: None,
                        }]))
                    } else {
                        SectionState::Missing
                    },
                })
                .collect(),
            keys: Vec::new(),
            front_intact: true,
        };
        let mut state = ScanState::default();
        state.apply(&read, 1);
        state
    }

    #[test]
    fn saved_sections_are_loaded_after_a_restart() {
        let dir = dir("roundtrip");
        let path = scan_state_path(&dir.join("inventory_state.json"));
        let state = state_with_alloy();
        save_scan_state(&path, &state);
        let loaded = load_scan_state(&path);
        assert_eq!(loaded.to_inventory(), state.to_inventory());
        assert_eq!(loaded.read_at("MiscItems"), Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_unreadable_file_starts_from_nothing() {
        let dir = dir("unreadable");
        let path = scan_state_path(&dir.join("inventory_state.json"));
        assert_eq!(load_scan_state(&path).to_saved().sections.len(), 0);
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(load_scan_state(&path).to_saved().sections.len(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
