import type { Ownership } from "./completionist.ts";
import type { PresetCodec } from "./filterPresets.ts";
import type { CatalogItem } from "./relics.ts";
import { matchesTerms, splitSearchTerms } from "./relics.ts";

/**
 * Inventory logic.
 * Filters keep a stable shape, so saved presets stay compatible.
 */

export const CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "all", label: "All Owned" },
  { id: "Resources", label: "Resources" },
  { id: "Mods", label: "Mods" },
  { id: "Relics", label: "Relics" },
  { id: "Arcanes", label: "Arcanes" },
  { id: "Warframes", label: "Warframes" },
  { id: "Primary", label: "Primary" },
  { id: "Secondary", label: "Secondary" },
  { id: "Melee", label: "Melee" },
  { id: "Companions", label: "Companions" },
  { id: "Archwing", label: "Archwing" },
  { id: "Operator Weapons", label: "Operator Weapons" },
  { id: "Parts", label: "Parts" },
  { id: "Blueprints", label: "Blueprints" },
  { id: "Miscellaneous", label: "Miscellaneous" },
  { id: "Sigils", label: "Sigils" },
  { id: "Glyphs", label: "Glyphs" },
  { id: "Skins", label: "Skins" },
  { id: "Railjack", label: "Railjack" },
];

export const SORT_MODES = [
  "qty-desc",
  "qty-asc",
  "name-asc",
  "name-desc",
  "plat-desc",
  "plat-asc",
  "ducat-desc",
  "ducat-asc",
  "ducat-ratio-desc",
  "ducat-ratio-asc",
] as const;
export type SortMode = (typeof SORT_MODES)[number];

export type InventoryFilters = {
  category: string;
  search: string;
  filterOwned: boolean;
  filterRecent: boolean;
  filterPrime: boolean;
  filterVaulted: boolean;
  filterUnvaulted: boolean;
  filterTradeable: boolean;
  /** Mod ranks to show (any of them); empty shows every rank. */
  filterRank: readonly ModRankFilter[];
  sortMode: SortMode;
};

export type ModRankFilter = number | "unranked";

/** Rank filter with `rank` switched on or off, kept in a stable order (Unranked, then ascending). */
export const toggleRank = (current: readonly ModRankFilter[], rank: ModRankFilter): ModRankFilter[] => {
  const next = current.includes(rank) ? current.filter((r) => r !== rank) : [...current, rank];
  return next.sort((a, b) => (a === "unranked" ? -1 : b === "unranked" ? 1 : a - b));
};

export const DEFAULT_INVENTORY_FILTERS: InventoryFilters = {
  category: "all",
  search: "",
  filterOwned: false,
  filterRecent: false,
  filterPrime: false,
  filterVaulted: false,
  filterUnvaulted: false,
  filterTradeable: false,
  filterRank: [],
  sortMode: "qty-desc",
};

export const needsPrices = (s: SortMode) => s.startsWith("plat") || s.startsWith("ducat-ratio");

/** Catalogue item with the fields only Inventory reads. */
export type InventoryCatalogItem = CatalogItem & { tradeable_wfm?: boolean | null };

/** Scanner mod counts: uniqueName → { total, by_rank }. */
export type ModCounts = Readonly<Record<string, { total: number; by_rank: Readonly<Record<string, number>> }>>;

export type InventoryRow = {
  item: InventoryCatalogItem;
  qty: number;
  plat: number | null;
  ducats: number | null;
  mastery: number;
};

export type InventoryContext = {
  items: readonly InventoryCatalogItem[];
  own: Ownership;
  /** Bulk platinum prices by lowercase name; null while loading or unavailable. */
  prices: ReadonlyMap<string, number> | null;
  /** uniqueName → last change (seconds). */
  lastChanged: Readonly<Record<string, number>>;
  mods: ModCounts;
};

const isModLike = (category: string) => category === "Mods" || category === "Arcanes";

function tradeable(item: InventoryCatalogItem, plat: number | null): boolean {
  return item.tradeable_wfm ?? (plat !== null || (item.ducats ?? 0) > 0 || isModLike(item.category));
}

/** Sort used now: price sorts fall back to `fallback` until prices are ready. */
export function effectiveSort(f: InventoryFilters, pricesReady: boolean, fallback: SortMode): SortMode {
  return needsPrices(f.sortMode) && !pricesReady ? fallback : f.sortMode;
}

export function visibleItems(f: InventoryFilters, ctx: InventoryContext, fallbackSort: SortMode = "qty-desc"): { rows: InventoryRow[] } {
  const terms = splitSearchTerms(f.search);
  const ready = ctx.prices !== null;
  const sort = effectiveSort(f, ready, fallbackSort);
  const rows: InventoryRow[] = [];
  for (const item of ctx.items) {
    if (item.name === "Blueprint") continue;
    if (f.category !== "all" && item.category !== f.category) continue;
    if (!matchesTerms(terms, item.name)) continue;
    const qty = ctx.own.subsumed.has(item.unique_name) ? 0 : (ctx.own.quantities[item.unique_name] ?? 0);
    if (f.filterOwned && qty === 0) continue;
    if (f.filterRecent && ctx.lastChanged[item.unique_name] === undefined) continue;
    if (f.filterPrime && !item.name.includes("Prime") && (item.vaulted ?? null) === null) continue;
    if (f.filterVaulted && item.vaulted !== true) continue;
    if (f.filterUnvaulted && item.vaulted !== false) continue;
    const plat = ctx.prices?.get(item.name.toLowerCase()) ?? null;
    const ducats = item.ducats ?? null;
    if (f.filterTradeable && !tradeable(item, plat)) continue;
    if (sort.startsWith("ducat-ratio")) {
      if (!(plat !== null && plat > 0 && ducats !== null && ducats > 0)) continue;
    } else if (sort.startsWith("plat")) {
      if (!(plat !== null && plat > 0)) continue;
    } else if (sort.startsWith("ducat") && !(ducats !== null && ducats > 0)) {
      continue;
    }
    if (f.filterRank.length > 0 && isModLike(item.category)) {
      const counts = ctx.mods[item.unique_name];
      if (!counts) continue;
      if (!f.filterRank.some((r) => (counts.by_rank[r === "unranked" ? "0" : String(r)] ?? 0) > 0)) continue;
    }
    rows.push({ item, qty, plat, ducats, mastery: ctx.own.mastery[item.unique_name] ?? 0 });
  }
  const byName = (a: InventoryRow, b: InventoryRow) => a.item.name.localeCompare(b.item.name);
  const ratio = (r: InventoryRow) => (r.ducats ?? 0) / (r.plat ?? 1);
  rows.sort((a, b) => {
    switch (sort) {
      case "plat-asc":
        return (a.plat ?? 0) - (b.plat ?? 0) || byName(a, b);
      case "plat-desc":
        return (b.plat ?? 0) - (a.plat ?? 0) || byName(a, b);
      case "ducat-asc":
        return (a.ducats ?? 0) - (b.ducats ?? 0) || byName(a, b);
      case "ducat-desc":
        return (b.ducats ?? 0) - (a.ducats ?? 0) || byName(a, b);
      case "ducat-ratio-asc":
        return ratio(a) - ratio(b) || byName(a, b);
      case "ducat-ratio-desc":
        return ratio(b) - ratio(a) || byName(a, b);
      default: {
        // Quantity and name sorts list owned items first.
        const owned = Number(b.qty > 0) - Number(a.qty > 0);
        if (owned !== 0) return owned;
        if (sort === "name-asc") return byName(a, b);
        if (sort === "name-desc") return byName(b, a);
        if (sort === "qty-asc") return a.qty - b.qty || byName(a, b);
        return b.qty - a.qty || byName(a, b);
      }
    }
  });
  return { rows };
}

/** Owned and total per category; "all" counts everything. */
export function categoryCounts(
  items: readonly InventoryCatalogItem[],
  own: Ownership,
): { owned: Record<string, number>; total: Record<string, number> } {
  const owned: Record<string, number> = { all: 0 };
  const total: Record<string, number> = { all: items.length };
  for (const item of items) {
    total[item.category] = (total[item.category] ?? 0) + 1;
    if ((own.quantities[item.unique_name] ?? 0) > 0) {
      owned.all = (owned.all ?? 0) + 1;
      owned[item.category] = (owned[item.category] ?? 0) + 1;
    }
  }
  return { owned, total };
}

/** Ranks above 0 that any scanned mod has, for the rank filter. */
export function availableRanks(mods: ModCounts): number[] {
  const set = new Set<number>();
  for (const m of Object.values(mods))
    for (const [rank, count] of Object.entries(m.by_rank)) if (Number(rank) > 0 && count > 0) set.add(Number(rank));
  return [...set].sort((a, b) => a - b);
}

// ── Changes ─────────────────────────────────────────────────────────────────

/** One quantity change (backend db.rs QuantityChange); timestamp in unix seconds. */
export type ChangeEntry = {
  /** Database row id; 0 for changes not stored yet. */
  id?: number;
  unique_name: string;
  item_name: string;
  old_qty?: number;
  new_qty?: number;
  delta: number;
  timestamp: number;
  rank?: number | null;
};

/** What "Changed recently" covers; chosen in Settings → Filters. */
export const RECENT_WINDOWS = ["session", "hour", "day", "week", "all"] as const;
export type RecentWindow = (typeof RECENT_WINDOWS)[number];

export const RECENT_WINDOW_LABEL: Readonly<Record<RecentWindow, string>> = {
  session: "Since HexDesk started",
  hour: "Last hour",
  day: "Last 24 hours",
  week: "Last 7 days",
  all: "Everything in the changelog",
};

/** The stored setting, or "since HexDesk started" when it is missing or unknown. */
export const recentWindowFrom = (v: unknown): RecentWindow =>
  typeof v === "string" && (RECENT_WINDOWS as readonly string[]).includes(v) ? (v as RecentWindow) : "session";

const WINDOW_SECONDS: Readonly<Record<"hour" | "day" | "week", number>> = { hour: 3600, day: 86_400, week: 604_800 };

/** Start of the window in unix seconds: changes at or after it count as recent. */
export function recentSince(window: RecentWindow, nowSec: number, appStartedAt: number): number {
  switch (window) {
    case "session":
      return appStartedAt;
    case "all":
      return 0;
    default:
      return nowSec - WINDOW_SECONDS[window];
  }
}

/**
 * Latest change time per item, counting only changes at or after `since`
 * (unix seconds). Items without such a change are not in the map, so the
 * "Changed recently" filter leaves them out.
 */
export function lastChangedMap(changes: readonly ChangeEntry[], since: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of changes) {
    if (c.timestamp >= since) out[c.unique_name] = Math.max(out[c.unique_name] ?? 0, c.timestamp);
  }
  return out;
}

/** Net change of one item since `since` (unix seconds), and how long ago it last changed; null without changes. */
export function recentDelta(
  changes: readonly ChangeEntry[],
  uniqueName: string,
  since: number,
  nowSec: number,
): { delta: number; minutesAgo: number } | null {
  const recent = changes.filter((c) => c.unique_name === uniqueName && c.timestamp >= since);
  const first = recent[0];
  if (!first) return null;
  // Whole-item entries carry the quantity change; per-rank entries (mods) only count when there are none.
  const whole = recent.filter((c) => c.rank === undefined || c.rank === null);
  const delta = (whole.length > 0 ? whole : recent).reduce((s, c) => s + c.delta, 0);
  const latest = Math.max(...recent.map((c) => c.timestamp));
  return { delta, minutesAgo: Math.max(0, Math.floor((nowSec - latest) / 60)) };
}

/** Short age for a change badge: now, 12m, 3h, 2d. */
export function formatAge(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h`;
  return `${String(Math.floor(minutes / (24 * 60)))}d`;
}

// ── Presets ─────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a stored Inventory preset, older shapes included; null when it is not valid. */
export const inventoryPresetCodec: PresetCodec<InventoryFilters> = {
  module: "inventory",
  decode: (v) => {
    if (!isRecord(v)) return null;
    const bools = ["filterOwned", "filterRecent", "filterPrime", "filterVaulted", "filterUnvaulted"] as const;
    if (typeof v.category !== "string" || typeof v.search !== "string" || bools.some((k) => typeof v[k] !== "boolean")) return null;
    // Older presets stored one rank (or null); newer ones a list.
    const isRank = (r: unknown): r is ModRankFilter => typeof r === "number" || r === "unranked";
    const rawRank: unknown = v.filterRank;
    let filterRank: ModRankFilter[];
    if (rawRank === null || rawRank === undefined) filterRank = [];
    else if (isRank(rawRank)) filterRank = [rawRank];
    else if (Array.isArray(rawRank) && rawRank.every(isRank))
      filterRank = rawRank.reduce<ModRankFilter[]>((acc, r) => (acc.includes(r) ? acc : toggleRank(acc, r)), []);
    else return null;
    const stored = v.sortMode;
    if (typeof stored !== "string" || !([...SORT_MODES, "recent"] as readonly string[]).includes(stored)) return null;
    const sortMode: SortMode =
      v.filterPlat === true
        ? stored === "plat-asc"
          ? "plat-asc"
          : "plat-desc"
        : v.filterDucats === true
          ? stored === "ducat-asc"
            ? "ducat-asc"
            : "ducat-desc"
          : stored === "recent"
            ? "qty-desc"
            : (stored as SortMode);
    return {
      category: v.category,
      search: v.search,
      filterOwned: v.filterOwned === true,
      filterRecent: v.filterRecent === true,
      filterPrime: v.filterPrime === true,
      filterVaulted: v.filterVaulted === true,
      filterUnvaulted: v.filterUnvaulted === true,
      filterTradeable: v.filterTradeable === true,
      filterRank,
      sortMode,
    };
  },
  encode: (f) => f,
};
