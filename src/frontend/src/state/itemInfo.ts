import type { ReactNode } from "react";
import type { ItemDetails } from "../domain/items";
import type { RelicSource } from "../domain/relics";
import { closeItemWindow, showItem, type ItemWindowTab } from "./itemWindow";

/** A catalogue item to show in the item window (state/itemWindow.ts). */
export type ItemInfoTarget = {
  uniqueName: string;
  name: string;
  imageName: string | null;
  category: string;
  /** Set for a prime set: its name ("Ash Prime"), whose parts the window lists. */
  set?: string;
};

/** Opens the item window on a catalogue item, on the tab used last; closes it with null. */
export function openItemInfo(target: ItemInfoTarget | null) {
  showItem(target ? { item: target, market: null, tab: null } : null);
}

export const closeItemInfo = closeItemWindow;

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
 * One block of the item window. The window shows every section whose
 * `appliesTo` holds on its `tab`, in the order given, so adding information
 * for a kind of item is a new entry, not a change to the window.
 */
export type InfoSection = {
  id: string;
  title: string;
  tab: Exclude<ItemWindowTab, "market">;
  appliesTo: (ctx: SectionContext) => boolean;
  render: (ctx: SectionContext) => ReactNode;
};
