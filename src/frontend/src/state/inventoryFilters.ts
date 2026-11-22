import { useSyncExternalStore } from "react";
import { DEFAULT_INVENTORY_FILTERS, type InventoryFilters } from "../domain/inventory";

/**
 * Inventory filters for the whole window. They outlive the Inventory screen,
 * and the changelog dock sets them when
 * it opens Inventory on an item or category.
 */
let current: InventoryFilters = DEFAULT_INVENTORY_FILTERS;
const listeners = new Set<() => void>();

export function getInventoryFilters(): InventoryFilters {
  return current;
}

export function setInventoryFilters(next: InventoryFilters | ((previous: InventoryFilters) => InventoryFilters)) {
  current = typeof next === "function" ? next(current) : next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInventoryFilters(): [InventoryFilters, typeof setInventoryFilters] {
  return [useSyncExternalStore(subscribe, getInventoryFilters), setInventoryFilters];
}

/** Only this item by name; the other filters stay. */
export const showItem = (name: string) => {
  setInventoryFilters((previous) => ({ ...previous, search: name }));
};

/** Only "Changed recently", optionally in one category; sorting stays. */
export const showRecent = (category?: string) => {
  setInventoryFilters((previous) => ({ ...DEFAULT_INVENTORY_FILTERS, filterRecent: true, category: category ?? "all", sortMode: previous.sortMode }));
};

/** For tests: back to the defaults. */
export const resetInventoryFilters = () => {
  setInventoryFilters(DEFAULT_INVENTORY_FILTERS);
};
