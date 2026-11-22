use std::collections::HashMap;
use tauri::{Emitter, Manager};
use tracing::{info, warn};

use crate::app_state::AppState;
use crate::events;

// ── Trade dialog parser ───────────────────────────────────────────────────────

struct ParsedTrade {
    with_player: String,
    trade_type: String,
    offered_items: Vec<(String, i64)>,
    offered_plat: i64,
    received_items: Vec<(String, i64)>,
    received_plat: i64,
    session_id: String,
    timestamp: String,
}

const MAX_TRADE_BUFFER_BYTES: usize = 256 * 1024;
const TRADE_SUCCESS_MARKER: &str = "the trade was successful";

/// Clean a single item line from a trade dialog:
/// strips Warframe PUA rank-dot characters and normalises mod rank suffixes.
fn clean_trade_item(raw: &str) -> String {
    let raw = raw.trim();
    let filled = raw.chars().filter(|&c| c == '\u{E114}').count();
    let total = raw
        .chars()
        .filter(|&c| c == '\u{E114}' || c == '\u{E112}')
        .count();
    if total > 0 {
        let base: String = raw
            .chars()
            .take_while(|&c| c != '\u{E114}' && c != '\u{E112}')
            .collect();
        let base = base.trim();
        return if filled == 0 {
            format!("{} (R0)", base)
        } else {
            format!("{} (R{})", base, filled)
        };
    }
    if let Some(p) = raw.find(" (") {
        let inside = &raw[p + 2..];
        if let Some(r) = inside.to_lowercase().find("rank ") {
            let rank_n = inside[r + 5..].trim_end_matches(')').trim();
            return format!("{} (R{})", &raw[..p], rank_n);
        }
        return raw[..p].trim().to_string();
    }
    raw.to_string()
}

/// Parse all items from one section of a trade dialog (offered or received).
/// Handles both repeated-line stacking and "Item x N" inline quantities.
fn extract_trade_items(section: &str) -> Vec<(String, i64)> {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, i64> = HashMap::new();
    for line in section.lines() {
        let raw = line.trim();
        if raw.is_empty() || raw.to_lowercase().contains("platinum") {
            continue;
        }
        let (raw_name, qty) = if let Some(x_pos) = raw.rfind(" x ") {
            let qty_part = raw[x_pos + 3..].trim();
            if let Ok(n) = qty_part.parse::<i64>() {
                (&raw[..x_pos], n)
            } else {
                (raw, 1i64)
            }
        } else {
            (raw, 1i64)
        };
        let name = clean_trade_item(raw_name);
        if !name.is_empty() {
            if !counts.contains_key(&name) {
                order.push(name.clone());
            }
            *counts.entry(name).or_insert(0) += qty;
        }
    }
    order
        .into_iter()
        .map(|k| {
            let q = counts[&k];
            (k, q)
        })
        .collect()
}

/// Parse the full trade confirmation dialog from EE.log.
/// Returns None if the dialog doesn't contain the expected markers.
fn parse_trade_dialog(raw: &str) -> Option<ParsedTrade> {
    // Player names in this dialog are sometimes suffixed by a private-use-area
    // glyph (e.g. U+E000, an in-game rank/status icon) with no preceding space —
    // strip trailing PUA codepoints so `with_player` doesn't carry it along.
    let with_player = raw.find("will receive from ").and_then(|i| {
        let a = &raw[i + 18..];
        a.find(" the following").map(|j| {
            a[..j]
                .trim()
                .trim_end_matches(|c: char| ('\u{E000}'..='\u{F8FF}').contains(&c))
                .trim()
                .to_string()
        })
    })?;
    let offered_raw = raw
        .find("You are offering:")
        .and_then(|i| {
            let a = &raw[i + 17..];
            a.find("and will receive from")
                .map(|j| a[..j].trim().to_string())
        })
        .unwrap_or_default();
    let received_raw = raw
        .find("the following:")
        .and_then(|i| {
            let a = &raw[i + 14..];
            a.find(", title=").map(|j| a[..j].trim().to_string())
        })
        .unwrap_or_default();

    let parse_plat = |s: &str| -> i64 {
        s.find("Platinum x ")
            .and_then(|i| s[i + 11..].split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };

    let offered_plat = parse_plat(&offered_raw);
    let received_plat = parse_plat(&received_raw);
    let offered_items = extract_trade_items(&offered_raw);
    let received_items = extract_trade_items(&received_raw);

    if offered_items.is_empty()
        && received_items.is_empty()
        && offered_plat == 0
        && received_plat == 0
    {
        return None;
    }

    let trade_type = if offered_plat > 0 {
        "purchase"
    } else if received_plat > 0 {
        "sale"
    } else {
        "trade"
    };
    let now = chrono::Utc::now();

    Some(ParsedTrade {
        with_player,
        trade_type: trade_type.to_string(),
        offered_items,
        offered_plat,
        received_items,
        received_plat,
        session_id: now.format("%Y%m%dT%H%M%S%3f").to_string(),
        timestamp: now.to_rfc3339(),
    })
}

/// Keep enough raw EE.log text to reconstruct a trade dialog when Windows wakes
/// the tailer while Warframe is still writing the multi-line log entry.
fn collect_trade_completion(buf: &str, trade_buffer: &mut String) -> (bool, Option<ParsedTrade>) {
    trade_buffer.push_str(buf);
    if trade_buffer.len() > MAX_TRADE_BUFFER_BYTES {
        let mut start = trade_buffer.len() - MAX_TRADE_BUFFER_BYTES;
        while !trade_buffer.is_char_boundary(start) {
            start += 1;
        }
        trade_buffer.drain(..start);
    }

    let mut scan_start = trade_buffer
        .len()
        .saturating_sub(buf.len() + TRADE_SUCCESS_MARKER.len());
    while !trade_buffer.is_char_boundary(scan_start) {
        scan_start += 1;
    }
    if !trade_buffer[scan_start..]
        .to_ascii_lowercase()
        .contains(TRADE_SUCCESS_MARKER)
    {
        return (false, None);
    }

    let lower = trade_buffer.to_ascii_lowercase();
    let trade = lower
        .rfind("dialog::createokcancel")
        .and_then(|start| parse_trade_dialog(&trade_buffer[start..]));
    trade_buffer.clear();
    (true, trade)
}

/// Detect an in-game trade offer dialog and its completion from EE.log text.
pub(crate) fn handle_trade_completion(
    app: &tauri::AppHandle,
    buf: &str,
    trade_buffer: &mut String,
) {
    let (completed, trade) = collect_trade_completion(buf, trade_buffer);
    if let Some(t) = trade {
        info!(
            with_player = %t.with_player,
            trade_type = %t.trade_type,
            offered_items = t.offered_items.len(),
            received_items = t.received_items.len(),
            "trade completion detected"
        );
        if let Err(error) = app.emit(events::TRADE_COMPLETED, serde_json::json!({
            "sessionId":     t.session_id,
            "withPlayer":    t.with_player,
            "tradeType":     t.trade_type,
            "offeredItems":  t.offered_items.iter().map(|(n, q)| serde_json::json!({"name": n, "qty": q})).collect::<Vec<_>>(),
            "offeredPlat":   t.offered_plat,
            "receivedItems": t.received_items.iter().map(|(n, q)| serde_json::json!({"name": n, "qty": q})).collect::<Vec<_>>(),
            "receivedPlat":  t.received_plat,
            "timestamp":     t.timestamp,
        })) {
            warn!(%error, "failed to emit trade-completed event");
        }
    } else if completed {
        warn!("trade completion detected, but confirmation dialog could not be parsed");
    }
}

/// Extract the local player name from EE.log lines containing "Logged in NAME".
/// Adds the name to shared_squad_names (for OCR filtering) and AppState.local_player_name
/// (for UI display). Safe to call with a single line or the full log contents.
pub(crate) fn parse_logged_in_name(
    text: &str,
    squad_names: &std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    app: &tauri::AppHandle,
) {
    // Target: "Sys [Info]: Logged in Sikewyrm"
    // The account-login line has exactly ONE token after "Logged in" and nothing more.
    // Lines like "Logged in to region server" have multiple tokens — skip them.
    // Match "]: Logged in " so we don't trigger on unrelated "Logged in …" phrases.
    const MARKER: &str = "]: Logged in ";
    for line in text.lines().rev() {
        let Some(pos) = line.find(MARKER) else {
            continue;
        };
        let after = line[pos + MARKER.len()..].trim();
        let name: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
        // Skip if anything follows the name — that means it's "Logged in to X", not an account.
        let remainder = after[name.len()..].trim();
        if name.len() < 3 || !remainder.is_empty() {
            continue;
        }
        hexdesk_diag::redact::register_secret(&name);
        if let Ok(mut g) = squad_names.lock() {
            if !g.iter().any(|n: &String| n == &name) {
                g.push(name.clone());
            }
        }
        if let Ok(mut n) = app.state::<AppState>().local_player_name.lock() {
            *n = Some(name.clone());
        }
        // Emit immediately so the header updates without waiting for the next scan tick.
        let _ = app.emit(events::PLAYER_NAME, &name);
        return;
    }
}

/// Seed local-player and squad names from bounded reads of the existing EE.log.
pub(crate) fn seed_ee_log_names(
    log_path: &std::path::Path,
    squad_names: &std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    app: &tauri::AppHandle,
) {
    use std::io::{Read, Seek, SeekFrom};

    if let Ok(mut f) = std::fs::File::open(log_path) {
        let mut first = Vec::with_capacity(64 * 1024);
        let _ = (&mut f).take(64 * 1024).read_to_end(&mut first);
        if let Ok(text) = std::str::from_utf8(&first) {
            parse_logged_in_name(text, squad_names, app);
        }

        let file_len = f.seek(SeekFrom::End(0)).unwrap_or(0);
        let read_from = file_len.saturating_sub(1_048_576);
        let _ = f.seek(SeekFrom::Start(read_from));
        let mut buf = Vec::with_capacity(1_048_576);
        let _ = f.read_to_end(&mut buf);
        let start = if read_from > 0 {
            buf.iter().position(|&b| b == b'\n').map_or(0, |i| i + 1)
        } else {
            0
        };
        if let Ok(text) = std::str::from_utf8(&buf[start..]) {
            parse_logged_in_name(text, squad_names, app);
            for line in text.lines() {
                let name =
                    if let Some(after) = line.find("AddSquadMember: ").map(|i| &line[i + 16..]) {
                        after
                            .split(',')
                            .next()
                            .map(str::trim)
                            .filter(|name| !name.is_empty())
                    } else if line.contains(" - new avatar: ") {
                        line.find("]: ")
                            .map(|i| &line[i + 3..])
                            .and_then(|after| after.split(" - new avatar:").next())
                            .map(str::trim)
                            .filter(|name| name.len() >= 3 && !name.contains(' '))
                    } else {
                        None
                    };
                if let Some(name) = name {
                    hexdesk_diag::redact::register_secret(name);
                    if let Ok(mut names) = squad_names.lock() {
                        if !names.iter().any(|existing| existing == name) {
                            names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }
}

/// Update the OCR name filter from newly appended EE.log lines.
pub(crate) fn collect_ee_log_names(
    text: &str,
    squad_names: &std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    app: &tauri::AppHandle,
) {
    for line in text.lines() {
        let name = if let Some(after) = line.find("AddSquadMember: ").map(|i| &line[i + 16..]) {
            after
                .split(',')
                .next()
                .map(str::trim)
                .filter(|name| !name.is_empty())
        } else if line.contains(" - new avatar: ") {
            line.find("]: ")
                .map(|i| &line[i + 3..])
                .and_then(|after| after.split(" - new avatar:").next())
                .map(str::trim)
                .filter(|name| name.len() >= 3 && !name.contains(' '))
        } else {
            None
        };
        if let Some(name) = name {
            hexdesk_diag::redact::register_secret(name);
            if let Ok(mut names) = squad_names.lock() {
                if !names.iter().any(|existing| existing == name) {
                    names.push(name.to_string());
                }
            }
        }
        if line.contains("Logged in ") {
            parse_logged_in_name(line, squad_names, app);
        }
    }
}

/// Collect the distinct relic projection paths announced while squad loadouts download.
pub(crate) fn collect_session_relics(text: &str, session_relics: &mut Vec<String>) {
    for line in text.lines() {
        if line.contains("Resource load completed")
            && line.contains("/Lotus/Types/Game/Projections/")
        {
            if let Some(paren) = line.find("(/Lotus/Types/Game/Projections/") {
                let path = line[paren + 1..].split(')').next().unwrap_or("").trim();
                if !path.is_empty() && !session_relics.iter().any(|relic| relic == path) {
                    session_relics.push(path.to_string());
                }
            }
        }
    }
}

/// Catch up `session_relics` from EE.log history at thread startup, for when
/// HexDesk is launched mid-mission — the live tailer only reads forward from
/// the file's current end, so any relic loads that already happened this mission
/// (before HexDesk attached) would otherwise never enter the OCR prefilter.
///
/// Reads the last `BACKFILL_BYTES` of EE.log and only considers text after the
/// most recent dismiss marker in that window (mirroring the live clear-on-dismiss
/// behavior), so relics from an already-closed earlier cycle aren't seeded in.
pub(crate) fn seed_session_relics(log_path: &std::path::Path, session_relics: &mut Vec<String>) {
    use std::io::{Read, Seek, SeekFrom};
    const BACKFILL_BYTES: u64 = 4 * 1024 * 1024;

    let Ok(mut f) = std::fs::File::open(log_path) else {
        return;
    };
    let file_len = f.seek(SeekFrom::End(0)).unwrap_or(0);
    let read_from = file_len.saturating_sub(BACKFILL_BYTES);
    if f.seek(SeekFrom::Start(read_from)).is_err() {
        return;
    }
    let mut buf = Vec::with_capacity((file_len - read_from) as usize);
    if f.read_to_end(&mut buf).is_err() {
        return;
    }
    let Ok(text) = std::str::from_utf8(&buf) else {
        return;
    };

    // ASCII-only lowercasing keeps byte offsets aligned with `text` so the slice
    // below can't land mid-character (unlike `to_lowercase()`, which can change
    // byte length for some non-ASCII input such as accented player names).
    let lower = text.to_ascii_lowercase();
    let last_dismiss_pos = [
        "relic reward screen shut down",
        "closevoidprojectionrewardscreen",
        "matchingservice::endsession",
    ]
    .iter()
    .filter_map(|marker| lower.rfind(marker))
    .max();
    let scan_from = last_dismiss_pos.unwrap_or(0);
    collect_session_relics(&text[scan_from..], session_relics);
}

#[derive(Default)]
pub(crate) struct VoidProjectionState {
    in_sequence: bool,
    other_ids: std::collections::HashSet<String>,
    own_item: String,
    // Squad members who cracked nothing this round ("<id> gets reward NULL").
    // No reward card is shown for them, so the EE hint (expected card count)
    // must subtract them from squad size or OCR retries past the point where
    // every real card has already been found.
    null_reward_ids: std::collections::HashSet<String>,
}

impl VoidProjectionState {
    pub(crate) fn take_own_item(&mut self) -> Option<String> {
        if self.own_item.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.own_item))
        }
    }
}

/// Update the VoidProjections reward-handshake state from newly appended EE.log lines.
pub(crate) fn collect_void_projection_state(
    text: &str,
    state: &mut VoidProjectionState,
    squad_size: &std::sync::Arc<std::sync::Mutex<Option<usize>>>,
) {
    for line in text.lines() {
        let lower = line.to_lowercase();
        if lower.contains("voidprojections: getvoidprojectionreward") {
            state.in_sequence = true;
            state.other_ids.clear();
            state.null_reward_ids.clear();
            state.own_item.clear();
            if let Ok(mut size) = squad_size.lock() {
                *size = None;
            }
        }
        if lower.contains("gets reward /lotus/") {
            if let Some(index) = line.find("/Lotus/") {
                state.own_item = line[index..].trim().to_string();
            }
        }
        if state.in_sequence {
            if lower.contains("still waiting on response from") {
                if let Some(id) = lower.split_whitespace().last() {
                    state.other_ids.insert(id.to_string());
                }
            } else if lower.contains("gets reward null") {
                if let Some(id) = lower.split_whitespace().next() {
                    state.null_reward_ids.insert(id.to_string());
                }
            } else if lower.contains("has reward info for all players now") {
                let squad_total = (1 + state.other_ids.len()).clamp(1, 4);
                let squad = squad_total
                    .saturating_sub(state.null_reward_ids.len())
                    .max(1);
                if let Ok(mut size) = squad_size.lock() {
                    *size = Some(squad);
                }
                state.in_sequence = false;
                hexdesk_diag::debug!(
                    relic_reward,
                    own_item = %state.own_item,
                    others_in_squad = state.other_ids.len(),
                    null_rewards = state.null_reward_ids.len(),
                    squad_total,
                    expected_cards = squad,
                    "Squad size read from EE.log"
                );
            }
        }
    }
}

/// Apply the local player's EE.log reward before the next memory scan completes.
pub(crate) fn apply_reward_inventory_update(app: &tauri::AppHandle, store_path: String) {
    let inv_path = crate::worldstate::store_to_unique(&store_path);
    let state: tauri::State<AppState> = app.state();
    let (old_qty, new_qty) = {
        let mut quantities = state
            .current_quantities
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let old = *quantities.get(&inv_path).unwrap_or(&0);
        let new = old + 1;
        quantities.insert(inv_path.clone(), new);
        (old, new)
    };
    crate::player::reward_applied(&inv_path, 1);
    let _ = app.emit(
        events::INVENTORY_REWARD,
        serde_json::json!({ "path": inv_path, "qty": new_qty }),
    );
    hexdesk_diag::info!(
        scanner,
        item = %inv_path,
        old_qty,
        new_qty,
        "Inventory updated from a relic reward in EE.log"
    );
}

// ── WFM whisper parsing ──────────────────────────────────────────────────────

pub(crate) fn parse_and_emit_wfm_whisper(app: &tauri::AppHandle, log_line: &str) {
    let raw = log_line;
    let from = raw
        .find("@From ")
        .map(|i| &raw[i + 6..])
        .and_then(|s| s.split(" :").next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let item = {
        let prefix = "want to buy ";
        let suffix = " for ";
        raw.find(prefix).and_then(|i| {
            let rest = &raw[i + prefix.len()..];
            rest.find(suffix)
                .map(|j| crate::sanitize_chat_item_name(&rest[..j]))
        })
    };
    let price: Option<u64> = raw.find(" for ").and_then(|i| {
        let rest = &raw[i + 5..];
        rest.find(" platinum")
            .and_then(|j| rest[..j].trim().parse().ok())
    });
    let _ = app.emit(
        events::WFM_WHISPER,
        serde_json::json!({
            "from": from,
            "message": raw.trim(),
            "item": item,
            "price": price,
            "timestamp": chrono::Local::now().format("%H:%M:%S").to_string(),
        }),
    );
}

#[cfg(test)]
mod trade_dialog_tests {
    use super::*;

    /// Real (player-redacted) dialog text captured from EE.log for a trade where
    /// the local player sold 4 Sevagoth Prime blueprints for 33 platinum. The
    /// player name is followed by a private-use-area glyph (U+E000) with no
    /// preceding space, and item lines are prefixed with a bare '\r'.
    /// Regression coverage for the "trades not detected" report (2026-09-28):
    /// the backend-modularization refactor (eaaaa42) accidentally turned the
    /// single-stage `received_raw` extraction into a two-stage one that
    /// re-searched the already-stripped substring for "the following:" — a
    /// string that, by construction, could never be found there again, so
    /// every trade's received side (items and/or platinum) silently vanished.
    #[test]
    fn trade_sale_for_platinum_extracts_received_plat_and_offered_items() {
        let raw = "1037.335 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\n\rSevagoth Prime Chassis Blueprint\n\rSevagoth Prime Neuroptics Blueprint\n\rSevagoth Prime Systems Blueprint\n\rSevagoth Prime Blueprint\r\n\r\nand will receive from Winter.Mine\u{E000} the following:\n\rPlatinum x 33, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)\n";

        let parsed = parse_trade_dialog(raw).expect("dialog should parse");
        assert_eq!(
            parsed.with_player, "Winter.Mine",
            "trailing PUA glyph should be stripped from the player name"
        );
        assert_eq!(parsed.trade_type, "sale");
        assert_eq!(
            parsed.received_plat, 33,
            "platinum received must survive the received_raw extraction"
        );
        assert_eq!(parsed.offered_plat, 0);
        assert!(parsed.received_items.is_empty());
        assert_eq!(
            parsed.offered_items,
            vec![
                ("Sevagoth Prime Chassis Blueprint".to_string(), 1),
                ("Sevagoth Prime Neuroptics Blueprint".to_string(), 1),
                ("Sevagoth Prime Systems Blueprint".to_string(), 1),
                ("Sevagoth Prime Blueprint".to_string(), 1),
            ]
        );
    }

    /// A purchase (offering platinum, receiving an item) must also keep its
    /// received side — this was silently empty under the same bug, which meant
    /// `useOverlays.ts`'s `tradeType === "purchase"` branch had nothing to log.
    #[test]
    fn trade_purchase_extracts_received_items() {
        let raw = "Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\r\nPlatinum x 20\r\n\r\nand will receive from Buyer123 the following:\r\nAyatan Anasa Sculpture, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)";

        let parsed = parse_trade_dialog(raw).expect("dialog should parse");
        assert_eq!(parsed.trade_type, "purchase");
        assert_eq!(parsed.offered_plat, 20);
        assert_eq!(
            parsed.received_items,
            vec![("Ayatan Anasa Sculpture".to_string(), 1)]
        );
    }

    #[test]
    fn trade_completion_reassembles_split_log_reads() {
        let chunks = [
            "unrelated log text\nDialog::CreateOkCan",
            "cel(description=Are you sure? You are off",
            "ering:\r\nSaryn Prime Chassis Blueprint\r\n\r\nand will receive from Buyer123 the follow",
            "ing:\r\nPlatinum x 15, title= leftItem=/Menu/Confirm_Item_Ok)\nThe trade was succ",
            "essful\n",
        ];
        let mut trade_buffer = String::new();
        let mut result = None;

        for chunk in chunks {
            let (_, parsed) = collect_trade_completion(chunk, &mut trade_buffer);
            if parsed.is_some() {
                result = parsed;
            }
        }

        let parsed = result.expect("split dialog and completion should be reconstructed");
        assert_eq!(parsed.with_player, "Buyer123");
        assert_eq!(parsed.trade_type, "sale");
        assert_eq!(parsed.received_plat, 15);
        assert_eq!(
            parsed.offered_items,
            vec![("Saryn Prime Chassis Blueprint".to_string(), 1)]
        );
        assert!(trade_buffer.is_empty());
    }
}
