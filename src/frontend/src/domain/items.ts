/**
 * Item details and card facts from the backend (src/backend/crates/items),
 * and the rules for showing them on a card.
 */

/** Card facts of one mod or arcane (get_card_meta). */
export type CardMeta = {
  rarity: string | null;
  polarity: string | null;
  compat: string | null;
  type_name: string;
  max_rank: number;
  augment: boolean;
};

export type RankStats = {
  lines: string[];
  /** Rank the text was written for; null for a general description. */
  text_rank: number | null;
};

export type Drop = {
  location: string;
  variant: string | null;
  /** Percent per roll. */
  chance: number;
  rarity: string | null;
};

export type ModDetails = {
  kind: "mod";
  unique_name: string;
  name: string;
  type_name: string;
  rarity: string | null;
  polarity: string | null;
  compat: string | null;
  max_rank: number;
  /** Index = rank; negative for mods that add capacity; empty when unknown. */
  drain_by_rank: number[];
  /** Index = rank; empty when there is no text. */
  stats_by_rank: RankStats[];
  augment: boolean;
  exilus: boolean;
  utility: boolean;
  tradable: boolean;
  drops: Drop[];
  wiki_url: string | null;
};

export type ArcaneDetails = {
  kind: "arcane";
  unique_name: string;
  name: string;
  type_name: string;
  rarity: string | null;
  max_rank: number;
  stats_by_rank: RankStats[];
  tradable: boolean;
  drops: Drop[];
  wiki_url: string | null;
};

/** Details of one item (get_item_details); null for items without details. */
export type ItemDetails = ModDetails | ArcaneDetails;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line under a card's name. Mods: what they fit and their polarity
 * ("Rifle · Madurai"). Arcanes: their type ("Warframe arcane"). Anything
 * else, or a mod or arcane without card facts: the category.
 */
export function cardSubline(category: string, meta: CardMeta | undefined): string {
  if (!meta) return category;
  if (category === "Arcanes") return meta.type_name ? capitalize(meta.type_name.toLowerCase()) : category;
  const parts = [meta.compat, meta.polarity ? capitalize(meta.polarity) : null].filter((p): p is string => !!p);
  if (meta.augment) parts.unshift("Augment");
  return parts.length > 0 ? parts.join(" · ") : category;
}

/** One row of the small table at the bottom of a card. */
export type CardRow = { label: string; value: string; muted?: boolean };

/** Rows a card shows before the rest collapse into "+N more". */
export const CARD_ROW_LIMIT = 4;

/** At most CARD_ROW_LIMIT rows; past that, the last row says how many are left out. */
export function limitRows(rows: readonly CardRow[]): CardRow[] {
  if (rows.length <= CARD_ROW_LIMIT) return [...rows];
  const shown = rows.slice(0, CARD_ROW_LIMIT - 1);
  const rest = rows.length - shown.length;
  return [...shown, { label: `+${String(rest)} more`, value: "", muted: true }];
}

/** Copies per owned rank, lowest rank first, with the max rank marked. */
export function rankRows(byRank: Readonly<Record<string, number>> | undefined, maxRank: number | undefined): CardRow[] {
  return Object.entries(byRank ?? {})
    .filter(([, count]) => count > 0)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank, count }) => ({
      label: rank === 0 ? "Unranked" : rank === maxRank ? `Rank ${String(rank)} (max)` : `Rank ${String(rank)}`,
      value: count.toLocaleString("en-US"),
    }));
}

/** Mastery facts of a levelled item: mastery state, required rank, Foundry. */
export function itemRows(item: { mastery_req?: number | null; masterable?: boolean | null }, mastery: number, building: boolean): CardRow[] {
  const rows: CardRow[] = [];
  const levelled = item.masterable === true || mastery > 0;
  if (levelled) rows.push({ label: "Mastery", value: mastery >= 30 ? "Mastered" : mastery > 0 ? `Rank ${String(mastery)}` : "Not levelled" });
  if (item.mastery_req != null && item.mastery_req > 0) rows.push({ label: "Requires", value: `MR ${String(item.mastery_req)}` });
  if (building) rows.push({ label: "Foundry", value: "Building" });
  return rows;
}

/** The rank the info window starts at: the highest rank you own, capped at the max rank. */
export function startRank(byRank: Readonly<Record<string, number>> | undefined, maxRank: number): number {
  const owned = Object.entries(byRank ?? {})
    .filter(([, count]) => count > 0)
    .map(([rank]) => Number(rank));
  return Math.min(maxRank, Math.max(0, ...owned));
}

/** A drop chance in percent: two decimals below 1%, otherwise at most one. */
export function formatChance(chance: number): string {
  const digits = chance < 1 ? 2 : 1;
  return `${chance.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

/** Mod capacity as shown in the game: a mod that adds capacity gets a plus sign. */
export function formatDrain(drain: number): string {
  return drain < 0 ? `+${String(-drain)}` : String(drain);
}
