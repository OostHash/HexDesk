import { useSyncExternalStore, type ReactNode } from "react";
import type { ItemDetails } from "../domain/items";
import type { RelicSource } from "../domain/relics";

/**
 * The item info window for the whole window. Item cards open it; the app
 * shell shows it once, next to the market item window (state/itemWindow.ts).
 */
export type ItemInfoTarget = {
  uniqueName: string;
  name: string;
  imageName: string | null;
  category: string;
  /** Set for a prime set: its name ("Ash Prime"), whose parts the window lists. */
  set?: string;
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

/** What every section gets to work with. */
export type SectionContext = {
  target: ItemInfoTarget;
  /** Null for items without details (anything but mods and arcanes). */
  details: ItemDetails | null;
  rank: number;
  setRank: (rank: number) => void;
  /** Copies per rank from the scanner; undefined when none are owned. */
  copies: Readonly<Record<string, number>> | undefined;
  /** Relics that drop the item; empty for items that do not drop from relics. */
  relics: readonly RelicSource[];
};

/**
 * One block of the item info window. The window shows every section whose
 * `appliesTo` holds, in the order of SECTIONS, so adding information for a
 * kind of item is a new entry here, not a change to the window.
 */
export type InfoSection = {
  id: string;
  title: string;
  appliesTo: (ctx: SectionContext) => boolean;
  render: (ctx: SectionContext) => ReactNode;
};
