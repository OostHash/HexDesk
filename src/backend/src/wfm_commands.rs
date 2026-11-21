use tauri::State;

use crate::app_state::AppState;
use crate::catalogue::fix_category;
use crate::inventory_state::{load_inventory_state_cache, CachedItem};
use crate::resolver::ItemResolver;
use crate::wfm::{to_wfm_slug, WfmItem, WfmRivenAttribute};
use hexdesk_persist::atomic_write;
// Moved to credentials.rs in the credentials batch.
use crate::credentials::wfm_delete_credentials;
use hexdesk_diag::{DiagError, Kind, Source};

/// A failure inside HexDesk itself: a worker task that stopped or a poisoned
/// lock.
fn internal_error<E: std::fmt::Display>(e: E) -> DiagError {
    DiagError::new(
        Source::Market,
        Kind::Internal,
        "warframe.market request stopped inside HexDesk",
    )
    .caused_by_text(e)
    .log()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RivenAuctionParams {
    weapon_url_name: String,
    riven_name: String,
    mastery_level: u32,
    mod_rank: u8,
    re_rolls: u32,
    polarity: String,
    attributes: Vec<WfmRivenAttribute>,
    starting_price: u32,
    buyout_price: Option<u32>,
    minimal_reputation: u32,
    note: String,
    visible: bool,
    is_direct_sell: bool,
}

// ─── Warframe.market ──────────────────────────────────────────────────────────

// ─── Warframe.market trading ──────────────────────────────────────────────────
// The WFM client lives in `wfm.rs`; the command handlers below are thin adapters
// over `state.wfm`. Session acquisition (this login webview) and keyring
// persistence stay here at the Tauri boundary.

/// Use the stored refresh token to silently get a new access token.
#[tauri::command]
pub(crate) fn wfm_refresh_token(state: State<AppState>) -> Result<(), DiagError> {
    state.wfm.refresh()
}

/// Restore a session from saved token data (JSON string).
/// Returns (username, status) so the frontend can set both in one step.
#[tauri::command]
pub(crate) fn wfm_set_jwt(
    state: State<AppState>,
    jwt: String,
) -> Result<(String, String), DiagError> {
    // `jwt` is the JSON bundle saved by wfm_save_credentials (or, for old saves,
    // a bare access token — restore_from_json handles both).
    state.wfm.restore_from_json(&jwt)
}

/// Log in via v1 signin (current recommended method per WFM Discord).
/// Token is returned in the set-cookie header: "JWT=eyJ...; Path=/; ..."
/// Use it as: Authorization: Bearer <token>
#[tauri::command]
pub(crate) fn wfm_login(
    state: State<AppState>,
    email: String,
    password: String,
) -> Result<String, DiagError> {
    state.wfm.login(&email, &password)
}

/// Fetch current in-game buy and sell orders for an item, sorted by price.
/// When `mod_rank` is provided the results are filtered to that specific rank only.
#[tauri::command]
pub(crate) fn wfm_get_item_orders(
    state: State<AppState>,
    url_name: String,
    mod_rank: Option<u32>,
) -> Result<serde_json::Value, DiagError> {
    state.wfm.item_orders(&url_name, mod_rank)
}

/// Fetch 90-day price statistics for an item (daily medians for the chart).
#[tauri::command]
pub(crate) fn wfm_get_item_statistics(
    state: State<AppState>,
    url_name: String,
) -> Result<serde_json::Value, DiagError> {
    state.wfm.item_statistics(&url_name)
}

/// Clear the stored WFM session.
///
/// A saved token outlives the in-memory session: the next launch restores it
/// before the user sees anything, so a logout that only cleared memory would
/// appear not to have happened. The delete sits here rather than at the call
/// site so every route to a logout inherits it.
#[tauri::command]
pub(crate) async fn wfm_logout(state: State<'_, AppState>) -> Result<(), DiagError> {
    state.wfm.clear_session();
    wfm_delete_credentials().await.map_err(|e| {
        DiagError::new(
            Source::Market,
            Kind::Io,
            "Signed out, but the saved warframe.market sign-in could not be removed",
        )
        .caused_by_text(e)
        .log()
    })
}

/// Return (username, status) for the current session, or None if not logged in.
#[tauri::command]
pub(crate) fn wfm_get_session(state: State<AppState>) -> Option<(String, String)> {
    state.wfm.identity()
}

/// Fetch the user's actual current status from WFM (`/v2/me`).
/// Returns one of: "online" | "ingame" | "invisible" | "offline".
/// Call this after session restore so the UI reflects what WFM actually has,
/// not just the hardcoded default.
#[tauri::command]
pub(crate) fn wfm_fetch_status(state: State<AppState>) -> Result<String, DiagError> {
    state.wfm.fetch_status()
}

/// Return the current session token data as JSON for saving.
#[tauri::command]
pub(crate) fn wfm_get_jwt(state: State<AppState>) -> Option<String> {
    state.wfm.token_json()
}

/// Fetch the authenticated user's active buy + sell orders.
#[tauri::command]
pub(crate) fn wfm_get_orders(state: State<AppState>) -> Result<serde_json::Value, DiagError> {
    state.wfm.my_orders()
}

/// Set WFM online status via WebSocket.
/// Connects, authenticates, sends status with 6-hour duration, then disconnects.
/// The duration means status persists even after the connection closes.
/// Values: "online" | "ingame" | "invisible"
#[tauri::command]
pub(crate) async fn wfm_set_status(
    state: State<'_, AppState>,
    status: String,
) -> Result<(), DiagError> {
    // The WebSocket round-trip is blocking; run it off the async runtime.
    let wfm = state.wfm.clone();
    tokio::task::spawn_blocking(move || wfm.set_status(&status))
        .await
        .map_err(internal_error)?
}

/// Get the internal WFM item ID for a URL slug (needed to create orders).
/// Also returns `modMaxRank` from the local WFCD item cache when the item is a mod,
/// so the frontend never needs a second network request to detect this.
#[tauri::command]
pub(crate) fn wfm_get_item_info(
    state: State<AppState>,
    url_name: String,
) -> Result<serde_json::Value, DiagError> {
    let mut data = state.wfm.item_info(&url_name)?;

    // Enrich with modMaxRank from inventory_state_cache.json — the canonical source.
    // Match by display name since url_name ↔ unique_name conversion isn't 1:1.
    if let Some(wfm_name) = data["i18n"]["en"]["name"]
        .as_str()
        .or_else(|| data["name"].as_str())
    {
        let wfm_name_lc = wfm_name.to_lowercase();
        let inv = load_inventory_state_cache(&state.inventory_state_cache_path);
        if let Some(max_rank) = inv
            .items
            .values()
            .find(|item| item.name.to_lowercase() == wfm_name_lc)
            .and_then(|item| item.mod_max_rank)
        {
            data["modMaxRank"] = serde_json::json!(max_rank);
        }
    }

    Ok(data)
}

/// Create a new buy or sell order. `mod_rank` must be set for mods — WFM returns 400 without it.
#[tauri::command]
pub(crate) fn wfm_create_order(
    state: State<AppState>,
    item_id: String,
    order_type: String,
    platinum: u32,
    quantity: u32,
    visible: bool,
    mod_rank: Option<u32>,
) -> Result<serde_json::Value, DiagError> {
    state
        .wfm
        .create_order(&item_id, &order_type, platinum, quantity, visible, mod_rank)
}

/// Update an existing order's price, quantity, or visibility.
#[tauri::command]
pub(crate) fn wfm_update_order(
    state: State<AppState>,
    order_id: String,
    platinum: u32,
    quantity: u32,
    visible: bool,
) -> Result<serde_json::Value, DiagError> {
    state
        .wfm
        .update_order(&order_id, platinum, quantity, visible)
}

/// Delete an order.
#[tauri::command]
pub(crate) fn wfm_delete_order(state: State<AppState>, order_id: String) -> Result<(), DiagError> {
    state.wfm.delete_order(&order_id)
}

/// Complete part or all of an order and record the transaction on WFM.
#[tauri::command]
pub(crate) fn wfm_close_order(
    state: State<AppState>,
    order_id: String,
    quantity: u32,
) -> Result<serde_json::Value, DiagError> {
    state.wfm.close_order(&order_id, quantity)
}

/// Post a revealed riven as an auction on warframe.market.
#[tauri::command]
pub(crate) fn wfm_create_riven_auction(
    state: State<AppState>,
    params: RivenAuctionParams,
) -> Result<serde_json::Value, DiagError> {
    let json = state.wfm.create_riven_auction(
        &params.weapon_url_name,
        &params.riven_name,
        params.mastery_level,
        params.mod_rank,
        params.re_rolls,
        &params.polarity,
        &params.attributes,
        params.starting_price,
        params.buyout_price,
        params.minimal_reputation,
        &params.note,
        params.visible,
        params.is_direct_sell,
    )?;
    record_new_auction_id(&state, &json);
    Ok(json)
}

/// Fetch the current user's active riven auctions from warframe.market.
/// Tries v2 /auctions/my first (returns all including hidden); falls back to the v1 profile
/// endpoint which only returns visible auctions.
#[tauri::command]
pub(crate) async fn wfm_get_my_riven_auctions(
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, DiagError> {
    let stored_ids = state
        .auction_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let wfm = state.wfm.clone();
    tauri::async_runtime::spawn_blocking(move || wfm.my_riven_auctions(&stored_ids))
        .await
        .map_err(internal_error)?
}

fn save_auction_ids(state: &State<AppState>) {
    let ids = state
        .auction_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if let Ok(json) = serde_json::to_string(&ids) {
        let _ = atomic_write(&state.auction_ids_path, json.as_bytes());
    }
}

/// Record a newly created auction's id so hidden auctions survive restarts.
/// HexDesk-created auctions can be hidden, and the WFM profile endpoint only
/// lists visible ones, so their ids are the only way to fetch them back.
fn record_new_auction_id(state: &State<AppState>, json: &serde_json::Value) {
    if let Some(id) = json["payload"]["auction"]["id"].as_str() {
        let mut ids = state.auction_ids.lock().unwrap_or_else(|e| e.into_inner());
        if !ids.contains(&id.to_string()) {
            ids.push(id.to_string());
            drop(ids);
            save_auction_ids(state);
        }
    }
}

/// Switch a riven auction between Auction and Direct Sale types.
/// The close-and-recreate lives in `Wfm`; here we reconcile the stored auction
/// ids — drop the closed one, record its replacement.
#[tauri::command]
pub(crate) fn wfm_switch_riven_type(
    state: State<AppState>,
    auction_id: String,
    new_is_direct_sell: bool,
    starting_price: u32,
    buyout_price: Option<u32>,
    visible: bool,
) -> Result<serde_json::Value, DiagError> {
    let json = state.wfm.switch_riven_type(
        &auction_id,
        new_is_direct_sell,
        starting_price,
        buyout_price,
        visible,
    )?;
    // The old listing is now closed; drop its id and record the replacement.
    state
        .auction_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|id| id != &auction_id);
    save_auction_ids(&state);
    record_new_auction_id(&state, &json);
    Ok(json)
}

/// Delete a riven auction via the /close endpoint.
#[tauri::command]
pub(crate) fn wfm_delete_auction(
    state: State<AppState>,
    auction_id: String,
) -> Result<(), DiagError> {
    state.wfm.delete_auction(&auction_id)?;
    state
        .auction_ids
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|id| id != &auction_id);
    save_auction_ids(&state);
    Ok(())
}

/// Update a riven auction's starting price, buyout price, and visibility.
/// Sends PUT /v1/auctions/entry/{id}. Pass buyout_price=None to clear the buyout.
#[tauri::command]
pub(crate) fn wfm_update_auction(
    state: State<AppState>,
    auction_id: String,
    starting_price: u32,
    buyout_price: Option<u32>,
    visible: bool,
) -> Result<(), DiagError> {
    state
        .wfm
        .update_auction(&auction_id, starting_price, buyout_price, visible)
}

/// Toggle visibility of a riven auction (visible / hidden).
#[tauri::command]
pub(crate) fn wfm_set_auction_visible(
    state: State<AppState>,
    auction_id: String,
    visible: bool,
) -> Result<(), DiagError> {
    state.wfm.set_auction_visible(&auction_id, visible)
}

/// Fetch warframe.market item list using v2 API (v1 /items returns 404).
#[tauri::command]
pub(crate) fn fetch_wfm_items(state: State<AppState>) -> Result<Vec<WfmItem>, DiagError> {
    state.wfm.items()
}

/// Fetch the 48-hour median sell price for an item by display name.
/// Results are cached in AppState so the overlay and main window share them.
/// Returns None when the item is not listed on warframe.market.
#[tauri::command]
pub(crate) fn get_item_price(
    item_name: String,
    state: State<AppState>,
) -> Result<Option<u32>, DiagError> {
    // 1. Check relics.run bulk price cache (no network call needed)
    {
        let prices = state.relics_run_prices.lock().map_err(internal_error)?;
        let key = item_name.to_lowercase();
        if let Some(&price) = prices.get(&key) {
            return Ok(Some(price));
        }
    }

    let slug = to_wfm_slug(&item_name);

    if let Some(cached) = state.wfm.cached_price(&slug) {
        return Ok(cached);
    }

    // Only strip "_blueprint" here — never append it. This is called with inventory
    // display names, where a prime component's name carries "Blueprint" but WFM lists
    // it without the suffix. A non-blueprint name must NOT fall back to a _blueprint
    // slug, or a frame would be priced as its blueprint.
    let price = state.wfm.price_for_slug(&slug)?.or_else(|| {
        slug.strip_suffix("_blueprint")
            .and_then(|base| state.wfm.price_for_slug(base).unwrap_or(None))
    });
    state.wfm.cache_price(slug, price);

    // Persist WFM price into the inventory cache file so it survives restarts.
    // Only write for tradeable items: prime parts/blueprints (have ducats) and mods/arcanes.
    if let Some(plat) = price {
        let cache_path = &state.inventory_state_cache_path;
        let mut inv = load_inventory_state_cache(cache_path);
        let items = state.wfcd_items.lock().map_err(internal_error)?;
        // Key the cache entry on the canonical unique_name, not the display string.
        let unique = ItemResolver::from_items(&items)
            .by_display(&item_name)
            .map(|r| r.unique_name.clone());
        if let Some(item) = unique.and_then(|u| items.iter().find(|i| i.unique_name == u)) {
            let cat = fix_category(
                &item.name,
                &item.item_type,
                &item.product_category,
                &item.category,
                &item.unique_name,
            );
            let tradeable = item.ducats.is_some() || matches!(cat.as_str(), "Mods" | "Arcanes");
            if tradeable {
                inv.items
                    .entry(item.unique_name.clone())
                    .or_insert_with(|| CachedItem {
                        unique_name: item.unique_name.clone(),
                        ..Default::default()
                    })
                    .wfm_price = Some(plat);
                if let Ok(json) = serde_json::to_string(&inv) {
                    let _ = atomic_write(cache_path, json.as_bytes());
                }
            }
        }
    }

    Ok(price)
}
