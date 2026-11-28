use hexdesk_diag::{debug, info, warn, DiagError, Kind, Source};
use std::collections::HashMap;
use tauri::State;

use hexdesk_overlays::read::riven;

use crate::app_state::AppState;
use crate::ocr;

// ─── Riven database ───────────────────────────────────────────────────────────

static RIVEN_ABBREVIATIONS: &[(&str, &str)] = &[
    ("CD", "Critical Damage"),
    ("CC", "Critical Chance"),
    ("MS", "Multishot"),
    ("DMG", "Base Damage"),
    ("FR", "Fire Rate"),
    ("SC", "Status Chance"),
    ("TOX", "Toxicity"),
    ("HEAT", "Heat"),
    ("ELEC", "Electricity"),
    ("COLD", "Cold"),
    ("PT", "Punch Through"),
    ("RLS", "Reload Speed"),
    ("MAG", "Magazine Size"),
    ("AMMO", "Ammo Maximum"),
    ("ZOOM", "Zoom"),
    ("REC", "Recoil"),
    ("SLASH", "Slash"),
    ("PUNC", "Puncture"),
    ("IMP", "Impact"),
    ("PFS", "Projectile Flight Speed"),
    ("SD", "Status Duration"),
    ("DTI", "Damage to Infested"),
    ("DTG", "Damage to Grineer"),
    ("DTC", "Damage to Corpus"),
    ("RLS", "Reload Speed"),
    ("AS", "Attack Speed"),
    ("RANGE", "Range"),
    ("IC", "Initial Combo"),
    ("CC", "Combo Count Chance"),
    ("EFF", "Heavy Attack Efficiency"),
    ("SLIDE", "Slide Critical Chance"),
    ("FIN", "Finisher Damage"),
    ("HA", "Heavy Attack Damage"),
    ("SLAM", "Slam Attack"),
];

/// Expand all-caps abbreviations in a notes string using the abbreviations table.
/// "PUNC gives 5%CC" → "Puncture gives 5% Critical Chance"
fn expand_abbrevs_in_notes(notes: &str) -> String {
    let bytes = notes.as_bytes();
    let mut result = String::with_capacity(notes.len() * 2);
    let mut last = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_uppercase() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_uppercase() {
                i += 1;
            }
            // Only expand if surrounded by non-alphabetic chars (word boundary)
            let prev_alpha = start > 0 && bytes[start - 1].is_ascii_alphabetic();
            let next_alpha = i < bytes.len() && bytes[i].is_ascii_alphabetic();
            if !prev_alpha && !next_alpha {
                let word = &notes[start..i];
                if let Some((_, full)) = RIVEN_ABBREVIATIONS.iter().find(|(a, _)| *a == word) {
                    result.push_str(&notes[last..start]);
                    result.push_str(full);
                    last = i;
                }
            }
        } else {
            i += 1;
        }
    }
    result.push_str(&notes[last..]);
    result
}

fn riven_abbrev_to_full(abbrev: &str) -> String {
    let up = abbrev.trim().to_uppercase();
    RIVEN_ABBREVIATIONS
        .iter()
        .find(|(a, _)| *a == up.as_str())
        .map(|(_, f)| f.to_string())
        .unwrap_or_else(|| abbrev.to_string())
}

/// Parse spreadsheet stat string into alternatives, each containing slot groups.
/// "or" = completely separate valid build paths — scored independently.
/// Space-separated = each token is its own required slot.
/// Slash-separated = any one of these fills that slot.
///
/// "TOX DTC or TOX DTG or CD MS/TOX/FR" →
///   [ [[TOX],[DTC]], [[TOX],[DTG]], [[CD],[MS,TOX,FR]] ]
fn parse_stat_alternatives(s: &str) -> Vec<Vec<Vec<String>>> {
    let without_note = s.split('(').next().unwrap_or(s);
    let mut alternatives: Vec<Vec<Vec<String>>> = Vec::new();
    for alt in without_note.split(" or ") {
        let mut groups: Vec<Vec<String>> = Vec::new();
        for token in alt.split_whitespace() {
            let options: Vec<String> = token
                .split('/')
                .filter_map(|t| {
                    let t = t.trim();
                    if t.is_empty() {
                        None
                    } else {
                        Some(riven_abbrev_to_full(t))
                    }
                })
                .collect();
            if !options.is_empty() {
                groups.push(options);
            }
        }
        if !groups.is_empty() {
            alternatives.push(groups);
        }
    }
    if alternatives.is_empty() {
        alternatives.push(vec![]);
    }
    alternatives
}

/// Flat list helper — kept for the wanted display (unique stat names across all alternatives)
fn parse_stat_groups(s: &str) -> Vec<Vec<String>> {
    let alts = parse_stat_alternatives(s);
    let mut all: Vec<Vec<String>> = Vec::new();
    for alt in alts {
        for group in alt {
            if !all.iter().any(|g| g == &group) {
                all.push(group);
            }
        }
    }
    all
}

/// Every stat named in a spreadsheet cell, across all its groups, without
/// duplicates.
fn parse_riven_stat_str(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    for group in parse_stat_groups(s) {
        for stat in group {
            if !result.contains(&stat) {
                result.push(stat);
            }
        }
    }
    result
}

fn csv_split_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    for ch in line.chars() {
        match ch {
            '"' => in_q = !in_q,
            ',' if !in_q => {
                fields.push(cur.trim().to_string());
                cur = String::new();
            }
            c => cur.push(c),
        }
    }
    fields.push(cur.trim().to_string());
    fields
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RivenEntry {
    pub weapon: String,
    /// Outer Vec = "or" alternatives (each is a completely separate valid build).
    /// Middle Vec = slot groups within that alternative.
    /// Inner Vec  = options for that slot (slash-separated).
    /// "TOX DTC or TOX DTG" → [[[TOX],[DTC]], [[TOX],[DTG]]]
    pub stat_alternatives: Vec<Vec<Vec<String>>>,
    /// Flat dedup list for backwards-compat display (unique groups across all alternatives)
    pub stat_groups: Vec<Vec<String>>,
    pub safe_negatives: Vec<String>,
    pub notes: String,
}

#[derive(serde::Serialize, Clone)]
pub struct AlternativeResult {
    pub label: String, // "Option 1", "Option 2", etc.
    pub matched: Vec<String>,
    pub missing: Vec<String>,
    pub score: f32,
    pub verdict: String,
}

#[derive(serde::Serialize)]
pub struct RivenAnalysis {
    pub weapon: String,
    pub matched_positives: Vec<String>, // best alternative
    pub missing_positives: Vec<String>, // best alternative
    pub safe_negatives_present: Vec<String>,
    pub harmful_negatives: Vec<String>,
    pub total_wanted: usize,
    pub score: f32,
    pub verdict: String,
    pub notes: String,
    pub alternatives: Vec<AlternativeResult>, // one per "or" path
}

static RIVEN_DB: std::sync::OnceLock<std::sync::Mutex<HashMap<String, RivenEntry>>> =
    std::sync::OnceLock::new();

/// Returns a map of weapon unique_name → riven disposition (omegaAttenuation).
/// Data comes from All.json (fetched during item load) — no extra HTTP request.
#[tauri::command]
pub(crate) fn get_weapon_dispositions(state: State<AppState>) -> HashMap<String, f32> {
    state
        .weapon_dispositions
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub(crate) fn get_riven_db() -> &'static std::sync::Mutex<HashMap<String, RivenEntry>> {
    RIVEN_DB.get_or_init(|| std::sync::Mutex::new(load_riven_csv_from_url().unwrap_or_default()))
}

const RIVEN_SHEET_ID: &str = "1zbaeJBuBn44cbVKzJins_E3hTDpnmvOk8heYN-G8yy8";
// Tabs: 0=primary, 1505239276=secondary, 1413904270=melee, 289737427=archwing, 965095749=other
// 1687910063 is the legend/info page — skip it
const RIVEN_SHEET_GIDS: &[u64] = &[0, 1505239276, 1413904270, 289737427, 965095749];

fn load_riven_csv_from_url() -> Result<HashMap<String, RivenEntry>, String> {
    let mut combined = HashMap::new();
    for &gid in RIVEN_SHEET_GIDS {
        let url = format!(
            "https://docs.google.com/spreadsheets/d/{}/export?format=csv&gid={}",
            RIVEN_SHEET_ID, gid
        );
        match ureq::get(&url)
            .header("User-Agent", concat!("HexDesk/", env!("CARGO_PKG_VERSION")))
            .call()
            .map_err(|e| e.to_string())
            .and_then(|mut r| r.body_mut().read_to_string().map_err(|e| e.to_string()))
        {
            Ok(csv) => {
                combined.extend(parse_riven_csv(&csv));
            }
            Err(e) => {
                warn!(catalogue, gid, error = %e, "Riven database tab could not be loaded");
            }
        }
    }
    if combined.is_empty() {
        return Err("No riven data loaded from any sheet tab".into());
    }
    Ok(combined)
}

fn parse_riven_csv(csv: &str) -> HashMap<String, RivenEntry> {
    let mut map = HashMap::new();
    let mut lines = csv.lines();

    // Read header to find which column holds "NEGATIVE STATS:" — it varies by tab
    let header = match lines.next() {
        Some(h) => h,
        None => return map,
    };
    let hf = csv_split_line(header);
    let neg_col = hf
        .iter()
        .position(|c| c.trim().to_lowercase().contains("negative"))
        .unwrap_or(5);
    let notes_col = hf
        .iter()
        .position(|c| c.trim().to_lowercase().contains("note"))
        .unwrap_or(8);

    for line in lines {
        let f = csv_split_line(line);
        if f.len() < neg_col + 1 {
            continue;
        }
        let weapon = f[0].trim().to_lowercase();
        if weapon.is_empty() {
            continue;
        }
        let stat_alternatives = parse_stat_alternatives(&f[1]);
        let stat_groups = parse_stat_groups(&f[1]);
        let safe_neg = parse_riven_stat_str(&f[neg_col]);
        let raw_notes = f
            .get(notes_col)
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or_default();
        let notes = expand_abbrevs_in_notes(&raw_notes);
        map.insert(
            weapon.clone(),
            RivenEntry {
                weapon,
                stat_alternatives,
                stat_groups,
                safe_negatives: safe_neg,
                notes,
            },
        );
    }
    map
}

/// Reads the riven card on screen: the weapon, the rolled stats and, on the
/// comparison screen, the stats of the card before the reroll.
pub(crate) async fn read_riven_card(
    visit: hexdesk_overlays::VisitId,
) -> Result<serde_json::Value, DiagError> {
    let started = std::time::Instant::now();
    info!(riven, "Riven OCR started");

    // Capture y 0–0.75: includes the "INVENTORY / MODS" header at the top and the
    // "FITS IN" weapon panel on the right. We retry until both markers are visible —
    // this filters out false EE.log triggers and handles slow screen transitions.
    const MAX_ATTEMPTS: u32 = 6;
    const RETRY_MS: u64 = 350;

    let mut text = String::new();
    let mut full_text_for_fallback = String::new();
    let mut panel_for_weapon = String::new();
    let mut confirmed = false;

    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(RETRY_MS)).await;
        }

        // One PrintWindow capture; two OCR passes from the same pixels:
        //   • Full width (0–100%) for validation markers ("INVENTORY/MODS" + "FITS IN")
        //   • Card column only (20–65%) for stat parsing — excludes the right panel whose
        //     "FITS IN" / weapon label text can interfere with reading the card's bottom stats.
        let attempt_result = tokio::task::spawn_blocking(move || {
            let px = ocr::capture_warframe_pixels().map_err(|e| {
                DiagError::new(
                    Source::Riven,
                    Kind::NotFound,
                    "Riven OCR failed: the Warframe window could not be captured",
                )
                .with("attempt", attempt + 1)
                .caused_by_text(e)
                .log()
            })?;
            let (pixels, w, h) = px;
            let frame = hexdesk_capture::Frame::new(pixels.clone(), w, h);
            if crate::captures::areas() {
                crate::captures::save_areas(
                    "riven",
                    &frame,
                    &[
                        hexdesk_capture::Rect::new(0.0, 1.0, 0.0, 0.82),
                        hexdesk_capture::Rect::new(0.20, 0.65, 0.28, 0.82),
                        hexdesk_capture::Rect::new(0.73, 1.0, 0.30, 0.95),
                    ],
                );
            }
            let full_text =
                ocr::ocr_pixels_rect(&pixels, w, h, 0.0, 1.0, 0.0, 0.82).unwrap_or_default();
            let card_text =
                ocr::ocr_pixels_rect(&pixels, w, h, 0.20, 0.65, 0.28, 0.82).unwrap_or_default();
            let panel_text =
                ocr::ocr_pixels_rect_raw(&pixels, w, h, 0.73, 1.0, 0.30, 0.95).unwrap_or_default();
            let testing_read = serde_json::json!({
                "full": &full_text,
                "card": &card_text,
                "weaponPanel": &panel_text,
            });
            crate::testing::save_json(
                visit,
                hexdesk_overlays::Overlay::Riven,
                &frame.to_bmp(),
                &serde_json::to_vec_pretty(&testing_read).unwrap_or_default(),
            );
            Ok::<_, DiagError>((full_text, panel_text, card_text))
        })
        .await
        .map_err(|e| {
            DiagError::new(
                Source::Riven,
                Kind::Internal,
                "Riven OCR failed: its worker task stopped",
            )
            .caused_by(&e)
            .log()
        })??;

        let (full_text, panel_text, card_text) = attempt_result;
        let lower = full_text.to_lowercase();
        let has_header = lower.contains("inventory") || lower.contains("mods");
        let has_fits_in =
            riven::says_fits_in(&lower) || riven::says_fits_in(&panel_text.to_lowercase());

        // Count stat lines in card_text — 5+ means comparison mode (two cards visible).
        // In comparison mode the "FITS IN" panel shifts and may not OCR correctly.
        // Accept header-only confirmation when we already see enough stat lines.
        let stat_count = card_text
            .lines()
            .filter(|l| {
                let t = l.trim();
                t.starts_with('+') || t.starts_with('-')
            })
            .count();
        let comparison_likely = stat_count >= 5;
        debug!(
            riven,
            attempt = attempt + 1,
            header = has_header,
            fits_in = has_fits_in,
            stat_lines = stat_count,
            "Riven OCR attempt"
        );

        if (has_header && has_fits_in) || (has_header && comparison_likely) {
            text = card_text;
            full_text_for_fallback = full_text;
            panel_for_weapon = panel_text;
            confirmed = true;
            break;
        }
        text = card_text;
        full_text_for_fallback = full_text;
        panel_for_weapon = panel_text;
    }

    if !confirmed {
        info!(
            riven,
            attempts = MAX_ATTEMPTS,
            "Riven screen markers not seen in any attempt, using the last read"
        );
    }

    let is_comparison = riven::is_comparison(&text);

    // On the comparison screen both cards are read from one more capture:
    // the card area split in half, left the roll before, right the new one.
    let (left_text, right_text) = if is_comparison {
        let cols = tokio::task::spawn_blocking(move || {
            match ocr::capture_warframe_pixels() {
                Ok((px, w, h)) => {
                    // Wider y range to catch element-icon stat lines near card bottom
                    let left =
                        ocr::ocr_pixels_rect(&px, w, h, 0.18, 0.44, 0.25, 0.84).unwrap_or_default();
                    let right =
                        ocr::ocr_pixels_rect(&px, w, h, 0.44, 0.68, 0.25, 0.84).unwrap_or_default();
                    (left, right)
                }
                Err(e) => {
                    let _ = DiagError::new(
                        Source::Riven,
                        Kind::NotFound,
                        "Riven comparison columns not read: the Warframe window could not be captured",
                    )
                    .caused_by_text(&e)
                    .log();
                    (String::new(), String::new())
                }
            }
        })
        .await
        .map_err(|e| {
            DiagError::new(Source::Riven, Kind::Internal, "Riven OCR failed: its worker task stopped")
                .caused_by(&e)
                .log()
        })?;
        cols
    } else {
        (String::new(), String::new())
    };

    let card = {
        let db = get_riven_db().lock().unwrap_or_else(|e| e.into_inner());
        riven::read_riven_card(
            &riven::RivenTexts {
                card: &text,
                full: &full_text_for_fallback,
                panel: &panel_for_weapon,
                left: &left_text,
                right: &right_text,
            },
            &|name| db.contains_key(name),
        )
    };
    info!(
        riven,
        weapon = %card.weapon,
        positives = card.positives.len(),
        negatives = card.negatives.len(),
        comparison = card.is_comparison,
        markers_seen = confirmed,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "Riven read"
    );
    let stats = |stats: &[riven::RivenStat]| -> Vec<serde_json::Value> {
        stats
            .iter()
            .map(
                |s| serde_json::json!({ "name": s.name, "value": s.value, "positive": s.positive }),
            )
            .collect()
    };
    Ok(serde_json::json!({
        "weapon": card.weapon,
        "positives": card.positives,
        "negatives": card.negatives,
        "rolled_stats": stats(&card.rolled_stats),
        "is_comparison": card.is_comparison,
        "original_rolled_stats": stats(&card.original_stats),
        "raw": card.raw,
    }))
}

// ── Saved rivens commands ─────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn save_riven_roll(
    state: tauri::State<'_, AppState>,
    weapon: String,
    label: String,
    stats_json: String,
    verdict: String,
    score: f64,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let count = crate::db::count_saved_rivens(&conn).unwrap_or(0);
    if count >= 50 {
        return Err("Maximum of 50 saved rivens reached. Delete some to save more.".into());
    }
    let id = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let saved_at = jiff::ZonedDateTime::now()
        .strftime("%Y-%m-%dT%H:%M:%S")
        .to_string();
    let riven = crate::db::SavedRiven {
        id: id.clone(),
        weapon,
        label,
        stats_json,
        verdict,
        score,
        saved_at,
    };
    crate::db::save_riven(&conn, &riven).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub(crate) fn get_saved_riven_rolls(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::db::SavedRiven>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    crate::db::get_saved_rivens(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn delete_saved_riven_roll(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    crate::db::delete_saved_riven(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn rename_saved_riven_roll(
    state: tauri::State<'_, AppState>,
    id: String,
    label: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    crate::db::rename_saved_riven(&conn, &id, &label).map_err(|e| e.to_string())
}

/// Return all weapon names that have riven data.
#[tauri::command]
pub(crate) fn get_riven_weapons() -> Vec<String> {
    let db = get_riven_db().lock().unwrap_or_else(|e| e.into_inner());
    let mut weapons: Vec<String> = db.keys().cloned().collect();
    weapons.sort();
    weapons
}

/// Reload the riven database from the Google Sheet.
#[tauri::command]
pub(crate) fn reload_riven_database() -> Result<usize, String> {
    let fresh = load_riven_csv_from_url()?;
    let count = fresh.len();
    *get_riven_db().lock().unwrap_or_else(|e| e.into_inner()) = fresh;
    Ok(count)
}

/// Analyse a riven roll for a given weapon.
/// positives / negatives are full stat names (e.g. "Critical Damage", "Zoom").
#[tauri::command]
pub(crate) fn analyze_riven(
    weapon: String,
    positives: Vec<String>,
    negatives: Vec<String>,
) -> Option<RivenAnalysis> {
    let db = get_riven_db().lock().unwrap_or_else(|e| e.into_inner());
    let key = weapon.to_lowercase();
    let entry = db.get(&key)?;

    let normalize = |s: &str| s.to_lowercase();

    // Score every "or" alternative independently — collect all results, pick best.
    let make_verdict = |s: f32, neg_ok: bool| -> String {
        match (s, neg_ok) {
            (s, true) if s >= 0.80 => "GREAT ROLL — Consider keeping".into(),
            (s, true) if s >= 0.60 => "GOOD ROLL — Decent for selling".into(),
            (s, _) if s >= 0.40 => "MEDIOCRE — Keep rolling".into(),
            _ => "BAD ROLL — Keep rolling".into(),
        }
    };
    // neg_ok = no harmful negatives rolled (i.e. rolled negs are NOT in the bad list)
    let neg_ok_pre = negatives.iter().all(|neg| {
        !entry
            .safe_negatives
            .iter()
            .any(|s| normalize(s) == normalize(neg))
    });

    let mut all_alternatives: Vec<AlternativeResult> = Vec::new();
    let mut best_matched: Vec<String> = Vec::new();
    let mut best_missing: Vec<String> = Vec::new();
    let mut best_score: f32 = -1.0_f32;

    for (idx, alternative) in entry.stat_alternatives.iter().enumerate() {
        if alternative.is_empty() {
            continue;
        }
        let mut m: Vec<String> = Vec::new();
        let mut ms: Vec<String> = Vec::new();
        for group in alternative {
            let hit = positives
                .iter()
                .find(|p| group.iter().any(|g| normalize(g) == normalize(p)));
            if let Some(stat) = hit {
                m.push(stat.clone());
            } else {
                ms.push(group.join(" / "));
            }
        }
        let s = m.len() as f32 / alternative.len() as f32;
        let label = if entry.stat_alternatives.len() == 1 {
            "Build".to_string()
        } else {
            format!("Option {}", idx + 1)
        };
        all_alternatives.push(AlternativeResult {
            label,
            matched: m.clone(),
            missing: ms.clone(),
            score: s,
            verdict: make_verdict(s, neg_ok_pre),
        });
        let better = s > best_score || (s == best_score && m.len() > best_matched.len());
        if better {
            best_score = s;
            best_matched = m;
            best_missing = ms;
        }
    }

    let matched = best_matched;
    let missing = best_missing;
    let score = if best_score < 0.0 { 0.0 } else { best_score };
    let total = entry
        .stat_alternatives
        .iter()
        .map(|a| a.len())
        .min()
        .unwrap_or(1)
        .max(1);

    // The spreadsheet "NEGATIVE STATS" column lists HARMFUL negatives to avoid.
    // Any negative NOT in that list is safe (doesn't matter for this weapon).
    let mut safe_present: Vec<String> = Vec::new();
    let mut harmful: Vec<String> = Vec::new();
    for neg in &negatives {
        if entry
            .safe_negatives
            .iter()
            .any(|s| normalize(s) == normalize(neg))
        {
            harmful.push(neg.clone()); // listed = BAD for this weapon
        } else {
            safe_present.push(neg.clone()); // not listed = safe/irrelevant
        }
    }
    let neg_ok = harmful.is_empty();

    let verdict = match (score, neg_ok) {
        (s, true) if s >= 0.80 => "GREAT ROLL — Consider keeping".to_string(),
        (s, true) if s >= 0.60 => "GOOD ROLL — Decent for selling".to_string(),
        (s, _) if s >= 0.40 => "MEDIOCRE — Keep rolling".to_string(),
        _ => "BAD ROLL — Keep rolling".to_string(),
    };

    Some(RivenAnalysis {
        weapon: entry.weapon.clone(),
        matched_positives: matched,
        missing_positives: missing,
        safe_negatives_present: safe_present,
        harmful_negatives: harmful,
        total_wanted: total,
        score,
        verdict,
        notes: entry.notes.clone(),
        alternatives: all_alternatives,
    })
}

pub fn refresh_riven_db_task(_app: &tauri::AppHandle, _force: bool) -> Result<(), String> {
    // Trigger a reload by clearing the cached database; next access will re-fetch.
    drop(get_riven_db().lock().unwrap_or_else(|e| e.into_inner()));
    Ok(())
}
