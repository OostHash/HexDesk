import { useSyncExternalStore } from "react";
import type { MarketTarget } from "../domain/market";
import type { ItemInfoTarget } from "./itemInfo";

/**
 * The item window for the whole window: one item with Market, Info, Relics
 * and Drops tabs. Item cards, set cards, prices and Trading open it; the app
 * shell shows it once, so it looks and works the same from everywhere.
 */
export type ItemWindowTab = "market" | "info" | "relics" | "drops";

export const ITEM_WINDOW_TABS: readonly ItemWindowTab[] = ["market", "info", "relics", "drops"];

/**
 * What to show. `item` names a catalogue item (Info, Relics, Drops); `market`
 * a warframe.market item (Market). Either may be missing: the window looks up
 * the other one by name.
 */
export type ItemWindowRequest = {
  item: ItemInfoTarget | null;
  market: MarketTarget | null;
  /** The tab to open on; null opens the tab used last. */
  tab: ItemWindowTab | null;
};

let current: ItemWindowRequest | null = null;
const listeners = new Set<() => void>();

/** Opens the window, or closes it with null. */
export function showItem(request: ItemWindowRequest | null) {
  current = request;
  for (const listener of listeners) listener();
}

/** Opens the window on a warframe.market item, on the Market tab. */
export function openItemWindow(target: MarketTarget | null) {
  showItem(target ? { item: null, market: target, tab: "market" } : null);
}

export const closeItemWindow = () => {
  showItem(null);
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useItemWindow(): ItemWindowRequest | null {
  return useSyncExternalStore(subscribe, () => current);
}

const LAST_TAB_KEY = "hexdesk.itemWindow.tab";

const isTab = (v: unknown): v is ItemWindowTab => typeof v === "string" && (ITEM_WINDOW_TABS as readonly string[]).includes(v);

/** The tab the window was last shown on; Info when none was stored. */
export function lastItemWindowTab(): ItemWindowTab {
  try {
    const stored = localStorage.getItem(LAST_TAB_KEY);
    return isTab(stored) ? stored : "info";
  } catch {
    return "info";
  }
}

export function rememberItemWindowTab(tab: ItemWindowTab) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // Without storage the window still works; it opens on Info next time.
  }
}
