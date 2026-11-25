import { useSyncExternalStore } from "react";

/**
 * The item info window for the whole window. Item cards open it; the app
 * shell shows it once, next to the market item window (state/itemWindow.ts).
 */
export type ItemInfoTarget = {
  uniqueName: string;
  name: string;
  imageName: string | null;
  category: string;
};

let current: ItemInfoTarget | null = null;
const listeners = new Set<() => void>();

export function openItemInfo(target: ItemInfoTarget | null) {
  current = target;
  for (const listener of listeners) listener();
}

export const closeItemInfo = () => {
  openItemInfo(null);
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useItemInfoTarget(): ItemInfoTarget | null {
  return useSyncExternalStore(subscribe, () => current);
}
