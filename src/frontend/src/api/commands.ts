import type { InvokeArgs } from "@tauri-apps/api/core";
import type { SyndicateStore, WeaponItem } from "../domain/completionist";
import type { FoundryItem, RecipeComponent } from "../domain/foundry";
import type { CacheStatuses } from "../domain/cache";
import type { LogEntry } from "../domain/console";
import type { RelicRewards } from "./events";
import type { ChangeEntry } from "../domain/inventory";
import type { WfmItemInfo, WfmItemOrders, WfmStatPoint } from "../domain/market";
import type { CatalogItem } from "../domain/relics";
import type { BackendCard } from "../domain/relicReward";
import type { SnapshotPoint, TopItem, TrackedItem, Trade } from "../domain/statistics";
import type { OwnedRiven, RivenAnalysis, SavedRiven, WfmRivenAttribute } from "../domain/rivens";
import type { WfmAuction, WfmManagedOrder } from "../domain/trading";
import type { WorldState } from "../domain/worldstate.types";

type CommandSpec = { args: InvokeArgs | undefined; result: unknown };

/**
 * Every Tauri command the new frontend calls, with its argument and result
 * types. Fixtures in src/dev/fixtures are typed against this map, so a command
 * cannot be mocked with the wrong payload.
 */
export interface CommandMap {
  fetch_worldstate: { args: undefined; result: WorldState };
  /** Whole settings file as JSON text; "" when there is none yet. */
  load_settings: { args: undefined; result: string };
  /** Merges the given top-level keys into the settings file; emits settings-updated. */
  save_settings: { args: { json: string }; result: null };
  /** Allows the ocrs models, downloading them first, or stops using them. */
  set_ocr_models: { args: { enabled: boolean }; result: null };
  /** Owned quantity per uniqueName. */
  get_current_quantities: { args: undefined; result: Record<string, number> };
  /** Cached companion-API inventory; only consumedSuits (Helminth) is used so far. */
  get_saved_inventory: { args: undefined; result: { consumedSuits: string[] } };
  get_syndicate_stores: { args: undefined; result: SyndicateStore[] };
  get_research_lab_stores: { args: undefined; result: SyndicateStore[] };
  get_weapon_catalog: { args: undefined; result: WeaponItem[] };
  /** Base URL of the local image server, e.g. "http://127.0.0.1:51234". */
  get_img_cache_dir: { args: undefined; result: string };
  get_all_items: { args: undefined; result: CatalogItem[] };
  /** Raw drop tables JSON; force re-downloads. */
  get_drop_data: { args: { force: boolean }; result: unknown };
  fetch_wfm_items: { args: undefined; result: Array<{ id: string; item_name: string; url_name: string }> };
  /** url_name to cached platinum price (null when unknown). */
  wfm_get_cached_prices: { args: undefined; result: Record<string, number | null> };
  /** Daily platinum prices by lowercase item name. */
  get_bulk_prices: { args: undefined; result: Record<string, number> };
  get_change_log: { args: { limit: number }; result: ChangeEntry[] };
  get_item_list_status: { args: undefined; result: { count: number; recipe_count: number } };
  /** Catalogue items that have a recipe. */
  get_craftable_items: { args: undefined; result: FoundryItem[] };
  /** Recipe per uniqueName; [] when unknown. */
  get_recipes_bulk: { args: { uniqueNames: string[] }; result: Record<string, RecipeComponent[]> };
  /** Component uniqueName to the relics (uniqueNames) that drop it. */
  get_relic_drops: { args: undefined; result: Record<string, string[]> };
  /** Starts the backend price queue (idempotent). */
  start_wfm_queue: { args: undefined; result: null };
  /** Queues price lookups; results arrive as wfm-price-update events. */
  wfm_queue_prices: { args: { urlNames: string[] }; result: null };
  wfm_queue_price_priority: { args: { urlName: string }; result: null };
  /** [username, status] when logged in to warframe.market. */
  wfm_get_session: { args: undefined; result: [string, string] | null };
  wfm_get_item_info: { args: { urlName: string }; result: WfmItemInfo | null };
  wfm_get_item_statistics: { args: { urlName: string }; result: WfmStatPoint[] };
  wfm_get_item_orders: { args: { urlName: string; modRank: number | null }; result: WfmItemOrders };
  /** Writes to warframe.market. */
  wfm_create_order: {
    args: { itemId: string; orderType: "sell" | "buy"; platinum: number; quantity: number; visible: boolean; modRank: number | null };
    result: unknown;
  };
  wfm_refresh_token: { args: undefined; result: null };
  /** Saved [email, token] for auto-login, or null. */
  wfm_load_credentials: { args: undefined; result: [string, string] | null };
  /** Restores a session from a saved token; returns [username, status]. */
  wfm_set_jwt: { args: { jwt: string }; result: [string, string] };
  /** Current token as JSON (includes the CSRF token), to save it again. */
  wfm_get_jwt: { args: undefined; result: string | null };
  wfm_save_credentials: { args: { email: string; token: string }; result: null };
  /** Returns the username. */
  wfm_login: { args: { email: string; password: string }; result: string };
  wfm_logout: { args: undefined; result: null };
  /** "online" | "ingame" | "invisible" | "offline" as warframe.market sees it. */
  wfm_fetch_status: { args: undefined; result: string };
  wfm_set_status: { args: { status: "online" | "ingame" | "invisible" }; result: null };
  wfm_get_orders: { args: undefined; result: WfmManagedOrder[] };
  wfm_update_order: { args: { orderId: string; platinum: number; quantity: number; visible: boolean }; result: unknown };
  wfm_delete_order: { args: { orderId: string }; result: null };
  /** Closes (part of) an order as sold, so warframe.market records the sale. */
  wfm_close_order: { args: { orderId: string; quantity: number }; result: unknown };
  wfm_get_my_riven_auctions: { args: undefined; result: { payload?: { auctions?: WfmAuction[] } } };
  wfm_set_auction_visible: { args: { auctionId: string; visible: boolean }; result: null };
  wfm_delete_auction: { args: { auctionId: string }; result: null };
  wfm_update_auction: { args: { auctionId: string; startingPrice: number; buyoutPrice: number | null; visible: boolean }; result: null };
  /** Deletes and recreates the auction with the other type (can take ~20 s). */
  wfm_switch_riven_type: {
    args: { auctionId: string; newIsDirectSell: boolean; startingPrice: number; buyoutPrice: number | null; visible: boolean };
    result: unknown;
  };
  /** Weapon names in the riven database (lowercase). */
  get_riven_weapons: { args: undefined; result: string[] };
  /** Re-downloads the riven database; returns the number of weapons. */
  reload_riven_database: { args: undefined; result: number };
  analyze_riven: { args: { weapon: string; positives: string[]; negatives: string[] }; result: RivenAnalysis | null };
  get_saved_riven_rolls: { args: undefined; result: SavedRiven[] };
  /** Returns the new id. */
  save_riven_roll: { args: { weapon: string; label: string; statsJson: string; verdict: string; score: number }; result: string };
  delete_saved_riven_roll: { args: { id: string }; result: null };
  rename_saved_riven_roll: { args: { id: string; label: string }; result: null };
  /** Rivens from the inventory blob. */
  get_rivens: { args: undefined; result: OwnedRiven[] };
  /** Weapon uniqueName → riven disposition (omega). */
  get_weapon_dispositions: { args: undefined; result: Record<string, number> };
  /** Posts a riven auction or direct sale on warframe.market. */
  wfm_create_riven_auction: {
    args: {
      params: {
        weaponUrlName: string;
        rivenName: string;
        masteryLevel: number;
        modRank: number;
        reRolls: number;
        polarity: string;
        attributes: WfmRivenAttribute[];
        startingPrice: number;
        buyoutPrice: number | null;
        minimalReputation: number;
        note: string;
        visible: boolean;
        isDirectSell: boolean;
      };
    };
    result: unknown;
  };
  get_trades: { args: undefined; result: Trade[] };
  /** Most traded warframe.market items of the last 7 days (can take minutes the first time). */
  get_wfm_top_items: { args: undefined; result: TopItem[] };
  get_tracked_items: { args: undefined; result: TrackedItem[] };
  add_tracked_item: { args: { uniqueName: string; displayName: string }; result: null };
  remove_tracked_item: { args: { uniqueName: string }; result: null };
  /** Daily quantity snapshots; days null = all. */
  get_item_snapshots: { args: { uniqueName: string; days: number | null }; result: SnapshotPoint[] };
  /** OS regional format, e.g. "nl-NL" (WebView2 may report another language). */
  get_system_locale: { args: undefined; result: string };
  /** Writes one trade to the trade log (Statistics). */
  add_trade: {
    args: {
      params: {
        withPlayer: string;
        direction: string;
        itemName: string;
        itemUrl: string;
        quantity: number;
        platinum: number;
        source: string;
        notes: string;
        /** In-game trades: groups the rows of one trade. */
        sessionId?: string;
        tradeType?: string;
        /** RFC 3339; the backend uses now when missing. */
        timestamp?: string;
      };
    };
    result: unknown;
  };
  /** Starts the memory scanner (idempotent); its catalogue is built at start. */
  start_monitor: { args: undefined; result: null };
  stop_monitor: { args: undefined; result: null };
  /** True while the memory scanner runs. */
  get_monitor_status: { args: undefined; result: boolean };
  /** Asks the scanner to look for the game now instead of at its next tick. */
  poke_scan: { args: undefined; result: null };
  /** Loads the item catalogue (force re-downloads); returns the item count. Emits catalogue-updated. */
  fetch_item_list: { args: { force: boolean }; result: number };
  /** Downloads missing item images into the local image cache. */
  prewarm_image_cache: { args: undefined; result: null };
  /** Logged-in Warframe account from EE.log, or null. */
  get_player_name: { args: undefined; result: string | null };
  /** Version of a newer release, or null. */
  check_for_update: { args: undefined; result: string | null };
  /** Downloads and installs the update, then restarts the app. */
  install_update: { args: undefined; result: null };
  /** Ends the process at once (std::process::exit). */
  force_quit: { args: undefined; result: null };
  /** Source and age of each backend data cache; updates arrive as cache-status. */
  get_cache_statuses: { args: undefined; result: CacheStatuses };
  /** Refreshes every data cache in the background. */
  refresh_all_caches: { args: undefined; result: null };
  /** Re-downloads the daily bulk prices now; fails without internet. */
  refresh_bulk_prices: { args: undefined; result: null };
  /** Forgets scanned quantities, mods and the change log (memory and disk). */
  clear_cache: { args: undefined; result: null };
  /** Deletes all app data, settings and the WFM login, then restarts. */
  factory_reset: { args: undefined; result: null };
  /** Warframe's client area [x, y, width, height] in physical pixels; fails when the game is not running. */
  get_warframe_window_rect: { args: undefined; result: [number, number, number, number] };
  /** Moves the relic-overlay window over the game (physical px) and shows it; the backend adds the saved offset. */
  show_overlay_window: { args: { x: number; y: number; w: number; h: number }; result: null };
  /** Parks the relic-overlay window off-screen (destroying transparent WebView2 windows deadlocks on Windows). */
  move_overlay_offscreen: { args: undefined; result: null };
  /** Rewards that arrived before the overlay listened; taking them clears them. */
  get_pending_relic_rewards: { args: undefined; result: RelicRewards | null };
  /** Catalogue entries for these paths plus their prime-set siblings. */
  get_items_by_paths: { args: { paths: string[] }; result: CatalogItem[] };
  /** Relic Reward cards with set parts and what the player owns of them. */
  get_reward_cards: { args: { paths: string[] }; result: BackendCard[] };
  /** Cached warframe.market price by item name, or null. */
  get_item_price: { args: { itemName: string }; result: number | null };
  /** Foundry jobs the scanner saw. */
  get_current_crafting: { args: undefined; result: Array<{ unique_name: string; item_name: string; completion_ms: number }> };
  /** Master switch for every overlay trigger in the backend. */
  set_overlays_enabled: { args: { enabled: boolean }; result: null };
  set_relic_pick_enabled: { args: { enabled: boolean }; result: null };
  set_relic_reward_enabled: { args: { enabled: boolean }; result: null };
  set_riven_enabled: { args: { enabled: boolean }; result: null };
  /** Only the overlay key opens an overlay; EE.log lines still close one. */
  set_overlay_manual: { args: { enabled: boolean }; result: null };
  /** The key that shows or hides the overlays, as a Windows virtual-key code (0 for none). */
  set_overlay_key: { args: { vk: number }; result: null };
  /** Save the screen title capture on each overlay key press, shown in the activity console. */
  set_overlay_key_capture: { args: { enabled: boolean }; result: null };
  set_overlay_screenshot: { args: { enabled: boolean }; result: null };
  /** Save the game frame with the areas each read uses outlined. */
  set_overlay_areas: { args: { enabled: boolean }; result: null };
  /** A saved screen capture as .bmp bytes, by file name. */
  get_capture: { args: { name: string }; result: ArrayBuffer };
  /** Places and shows the relic pick window (no payload): previews and offset changes. */
  show_relic_pick_window: { args: undefined; result: null };
  /** Parks the relic pick window off-screen while keeping its transparent WebView2 alive. */
  park_relic_pick_window: { args: undefined; result: null };
  /** Places the status line at the top centre of the game window. */
  show_overlay_status_window: { args: undefined; result: null };
  overlay_closed: { args: undefined; result: null };
  overlay_rendered: { args: { overlay: "relic_pick" | "relic_reward" | "riven"; view: number; summary: string }; result: null };
  /** Runs a riven check: a new roll on the riven screen, or the riven screen opened as by the overlay key. */
  check_riven: { args: undefined; result: null };
  /** Places and shows the riven window (no view): the Settings preview. */
  show_riven_window: { args: undefined; result: null };
  /** Appends "[FE] msg" to the overlay session log (Settings → Debugging → Overlay log). */
  log_relic_fe: { args: { msg: string }; result: null };
  // ── Diagnostics (Settings → Debugging, Settings → Console) ──
  /** The most recent log entries, oldest first (activity console); new ones follow as diag-entry events. */
  get_recent_logs: { args: { limit?: number }; result: LogEntry[] };
  /** Removes diagnostic logs, OCR captures and pending test samples, then starts a fresh active-session log. */
  remove_logs: { args: undefined; result: null };
  /** Writes the diagnostics zip (logs, system facts, settings; redacted) and returns its path. */
  export_diagnostics: { args: { parts: DiagnosticsParts }; result: string };
  /** Opens Explorer with an exported diagnostics zip selected. */
  show_diagnostics_export: { args: { path: string }; result: null };
}

export type CommandName = keyof CommandMap;
export type CommandArgs<C extends CommandName> = CommandMap[C]["args"];
export type CommandResult<C extends CommandName> = CommandMap[C]["result"];

// Compile-time check: every entry has IPC-compatible arguments.
type AssertSpecs<T extends Record<CommandName, CommandSpec>> = T;
export type CheckedCommandMap = AssertSpecs<CommandMap>;

/** Which parts go into a diagnostics export; the user picks them before exporting. */
export type DiagnosticsParts = { system: boolean; settings: boolean; activity: boolean; logs: boolean };
