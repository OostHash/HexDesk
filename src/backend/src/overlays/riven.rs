//! The riven check: reading the riven card on screen and rating the roll
//! for the riven overlay.

use hexdesk_overlays::VisitId;
use serde_json::{json, Value};
use tracing::{Instrument, Span};

use super::{send, Input};

/// Reads the riven card in the background and sends [`Input::RivenReady`]
/// with the view for roll number `roll` of the visit.
pub(super) fn check(visit: VisitId, roll: u32, op: Span) {
    tauri::async_runtime::spawn(
        async move {
            let view = match crate::rivens::read_riven_card(visit).await {
                Ok(card) => {
                    let analysis = analyse(&card);
                    result(&card, analysis, roll)
                }
                Err(error) => failed(&error.to_string(), roll),
            };
            send(Input::RivenReady { visit, view });
        }
        .instrument(op),
    );
}

/// The view while the card is read.
pub(super) fn scanning(roll: u32) -> Value {
    json!({ "kind": "scanning", "rollCount": roll })
}

/// The roll rated against the weapon's wanted and harmful stats, when the
/// card named a weapon or a positive stat; None when it did not or the
/// weapon is not in the riven database.
fn analyse(card: &Value) -> Option<Value> {
    let strings = |key: &str| -> Vec<String> {
        card[key]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let weapon = card["weapon"].as_str().unwrap_or_default().to_string();
    let positives = strings("positives");
    if weapon.is_empty() && positives.is_empty() {
        return None;
    }
    let analysis = crate::rivens::analyze_riven(weapon, positives, strings("negatives"))?;
    serde_json::to_value(analysis).ok()
}

/// The view of a card that was read: what `src/frontend/src/domain/rivenOverlay.ts`
/// calls a result.
fn result(card: &Value, analysis: Option<Value>, roll: u32) -> Value {
    json!({
        "kind": "result",
        "preview": false,
        "rollCount": roll,
        "analysis": analysis,
        "weapon": card["weapon"].as_str().unwrap_or_default(),
        "rolledStats": card.get("rolled_stats").cloned().unwrap_or_else(|| json!([])),
        "originalStats": card.get("original_rolled_stats").cloned().unwrap_or_else(|| json!([])),
        "isComparison": card["is_comparison"].as_bool().unwrap_or(false),
        "ocrRaw": card["raw"].as_str().unwrap_or_default(),
    })
}

/// The view when the card could not be read.
fn failed(error: &str, roll: u32) -> Value {
    json!({
        "kind": "result",
        "preview": false,
        "rollCount": roll,
        "analysis": null,
        "weapon": "",
        "rolledStats": [],
        "originalStats": [],
        "isComparison": false,
        "ocrRaw": format!("OCR ERROR: {error}"),
    })
}

/// One line for the log: the weapon and how many stats were read.
pub(super) fn describe(view: &Value) -> String {
    let weapon = view["weapon"].as_str().filter(|w| !w.is_empty());
    let stats = view["rolledStats"].as_array().map_or(0, Vec::len);
    match (weapon, view["ocrRaw"].as_str()) {
        (_, Some(raw)) if raw.starts_with("OCR ERROR") => raw.to_string(),
        (Some(weapon), _) => format!("{weapon}, {stats} stats"),
        (None, _) => format!("no weapon, {stats} stats"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_read_card_becomes_a_result_view() {
        let card = json!({
            "weapon": "Tenora Prime",
            "positives": ["Critical Chance"],
            "negatives": [],
            "rolled_stats": [{ "name": "Critical Chance", "value": "+120%", "positive": true }],
            "is_comparison": false,
            "original_rolled_stats": [],
            "raw": "TENORA PRIME",
        });
        let view = result(&card, None, 3);
        assert_eq!(view["kind"], "result");
        assert_eq!(view["rollCount"], 3);
        assert_eq!(view["weapon"], "Tenora Prime");
        assert_eq!(view["rolledStats"][0]["value"], "+120%");
        assert_eq!(view["analysis"], Value::Null);
        assert_eq!(describe(&view), "Tenora Prime, 1 stats");
    }

    #[test]
    fn a_failed_read_says_why() {
        let view = failed("the Warframe window could not be captured", 1);
        assert_eq!(
            describe(&view),
            "OCR ERROR: the Warframe window could not be captured"
        );
    }

    #[test]
    fn a_card_without_weapon_or_positives_is_not_analysed() {
        assert_eq!(analyse(&json!({ "weapon": "", "positives": [] })), None);
    }
}
