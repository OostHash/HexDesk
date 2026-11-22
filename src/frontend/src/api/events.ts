import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { isTauri } from "./env";
import type { CacheStatuses } from "../domain/cache";
import type { LogEntry } from "../domain/console";
import type { ChangeEntry } from "../domain/inventory";
import type { RelicPick } from "../domain/relicPick";
import type { RivenView } from "../domain/rivenOverlay";
import type { FlowKind } from "../domain/testing";
import type { TradeCompleted } from "../domain/trading";

/**
 * Backend → frontend events the frontend uses, with payload types. The names
 * match src/backend/src/events.rs. Add an entry when a screen needs a new event.
 */
/** Subset of the backend InventoryUpdate (src/backend/src/monitor.rs) the frontend reads. */
export type InventoryUpdatePayload = {
  quantities: Record<string, number>;
  /** uniqueName to mastery rank; only present in some updates (not on heartbeats). */
  mastery_data: Record<string, number>;
  /** Helminth-consumed warframes; empty when the scanner did not see them this time. */
  consumed_suits: string[];
  /** Mods and arcanes per rank; empty until the scanner has data. */
  mods: Record<string, { total: number; by_rank: Record<string, number> }>;
  /** Items being built in the Foundry. */
  crafting: Array<{ unique_name: string; item_name: string; completion_ms: number }>;
  /** Quantity changes since the previous update. */
  changes: ChangeEntry[];
  warframe_running: boolean;
  /** Account mastery rank; null until the scanner read it. */
  mastery_rank?: number | null;
  /** Logged-in account, when the scanner knows it. */
  player_name?: string | null;
  /** When this update was scanned (unix seconds). */
  scanned_at?: number;
  /** Warframe uniqueName to socketed Archon Shards; only frames the scanner saw. */
  socketed_shards?: Record<string, Array<{ upgrade_type: string; color: string }>>;
  /** Item uniqueName to Forma applied; only items with at least one. */
  forma_counts?: Record<string, number>;
  /** End of a full scanner pass: shards and Forma replace instead of merge. */
  is_full_pass?: boolean;
};

/**
 * Locked relic rewards: uniqueName per slot ("?:text" when OCR did not recognise it), the slot's x (0–1),
 * and per slot whether the match is uncertain (reads disagreed, or only part of the name was read).
 */
export type RelicRewards = { items: string[]; positions: number[]; uncertain?: boolean[] };

export interface EventMap {
  "settings-updated": unknown;
  "catalogue-updated": number;
  "inventory-update": InventoryUpdatePayload;
  /** Memory blob capture: "scanning" when it starts, "done" with a summary. */
  "blob-status": { stage: string; detail: string };
  /** Logged-in Warframe account, from EE.log. */
  "player-name": string;
  /** One new log entry for the activity console (main window only). */
  "diag-entry": LogEntry;
  /** All data cache statuses, after any cache changed. */
  "cache-status": CacheStatuses;
  "bulk-prices-updated": unknown;
  "trades-updated": unknown;
  /** One price from the backend queue (wfm_queue_prices). */
  "wfm-price-update": { url_name: string; sell_median: number | null; tradeable: boolean };
  /** A warframe.market trade whisper from the game log. */
  "wfm-whisper": { from: string; message: string; item?: string; price?: number; timestamp: string };
  /** Progress of the warframe.market top-items scan. */
  "wfm-top-progress": { completed: number; total: number; refreshing: boolean };
  /** A new top-items ranking. */
  "wfm-top-updated": Array<{ name: string; url_name: string; image_name?: string; unit_price: number; daily_volume: number; total_value_7d: number }>;
  /** A riven was unveiled in game (EE.log). */
  "riven-unveiled": unknown;
  /** The riven overlay saved a roll. */
  "riven-roll-saved": unknown;
  /** An in-game trade finished (EE.log). */
  "trade-completed": TradeCompleted;
  /** The fissure reward screen opened: clear the overlay and place it. */
  "relic-trigger": null;
  /** Rewards were read; null or empty closes the overlay. */
  "relic-rewards": RelicRewards | null;
  /** The relic selection screen opened or closed. */
  "relic-screen": boolean;
  /** Overlays were switched off: every overlay window hides. */
  "overlays-disabled": unknown;
  /** Short backend status line for the app header and the in-game status window. */
  "status-line": string;
  /** Scoped Page Up/Page Down prompt after a completed testing flow. */
  /** `timeoutMs`: how long the prompt stays up unanswered. */
  "testing-feedback": { visible: true; flow: FlowKind; timeoutMs: number } | { visible: false };
  /** A short in-game confirmation of a testing answer. */
  "testing-notice": { text: string; tone: "success" | "danger" };
  /** A reported testing flow could not be stored. */
  "test-report": { error: string };
  /** How many reported testing flows wait for an export. */
  "test-report-flows": number;
  /** The relic selection screen opened: which relics to run. */
  "relic-pick-open": RelicPick;
  "relic-pick-close": unknown;
  /** Settings preview of the relic pick overlay. */
  "relic-pick-preview": unknown;
  "relic-pick-preview-close": unknown;
  /** The riven overlay's state, from the backend; null when it hides. */
  "riven-view": RivenView | null;
  /** Settings preview of the riven overlay. */
  "riven-preview": unknown;
  "riven-preview-close": unknown;
  /** Settings preview of the reward overlay. */
  "relic-reward-preview": unknown;
  "relic-reward-preview-close": unknown;
  /** One item's new quantity after a relic reward was picked up. */
  "inventory-reward": { path: string; qty: number };
  /** The changelog pop-out asks the main window to open Inventory on an item, or on recent changes (in a category). */
  "changelog-open-inventory": { item?: string; category?: string };
}

export type EventName = keyof EventMap;

/** Typed wrapper around Tauri's listen. The only place the app subscribes to backend events. */
export function onEvent<E extends EventName>(event: E, handler: (payload: EventMap[E]) => void): Promise<UnlistenFn> {
  return listen<EventMap[E]>(event, (e) => {
    handler(e.payload);
  });
}

/**
 * Calls `handler` for every `event` while the component is mounted. The latest `handler` is used, so it may
 * change between renders without subscribing again.
 */
export function useEvent<E extends EventName>(event: E, handler: (payload: EventMap[E]) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void onEvent(event, (payload) => {
      latest.current(payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}

/** Tells every window something changed (e.g. trades-updated after logging a trade). */
export function emitEvent(
  event:
    | "trades-updated"
    | "overlays-disabled"
    | "relic-reward-preview"
    | "relic-reward-preview-close"
    | "relic-pick-preview"
    | "relic-pick-preview-close"
    | "riven-preview"
    | "riven-preview-close"
    | "riven-roll-saved",
): Promise<void> {
  return emit(event, {});
}

/** Window-to-window events that carry data. */
export function emitWith<E extends "relic-screen" | "changelog-open-inventory" | "status-line">(event: E, payload: EventMap[E]): Promise<void> {
  return emit(event, payload);
}
