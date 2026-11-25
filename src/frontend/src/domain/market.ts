import type { Ownership } from "./completionist.ts";
import type { PresetCodec } from "./filterPresets.ts";
import type { RecipeComponent } from "./foundry.ts";
import type { ModCounts, ModRankFilter } from "./inventory.ts";
import { matchMod } from "./modSearch.ts";
import { inModGroup, isExilusMod, isIncomplete, modDisplayName, modGroups, type CardMeta } from "./items.ts";
import type { CatalogItem } from "./relics.ts";
import { matchesTerms, splitSearchTerms } from "./relics.ts";

/**
 * Market logic (part 1: Prime Sets, Mods & Arcanes, item window).
 */

// ── warframe.market names ───────────────────────────────────────────────────

export type WfmItem = { id: string; item_name: string; url_name: string };

export const normalizeForWfm = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * Normalised name → slug. Exact names first; then "…Blueprint" ↔ without
 * "Blueprint" aliases, only where that key is still free.
 */
export function buildWfmLookup(items: readonly WfmItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const w of items) map.set(normalizeForWfm(w.item_name), w.url_name);
  for (const w of items) {
    const key = normalizeForWfm(w.item_name);
    const alias = key.endsWith("_blueprint") ? key.slice(0, -"_blueprint".length) : `${key}_blueprint`;
    if (!map.has(alias)) map.set(alias, w.url_name);
  }
  return map;
}

/** Slug for a name; falls back to the normalised name. */
export const slugFor = (lookup: ReadonlyMap<string, string>, name: string) => lookup.get(normalizeForWfm(name)) ?? normalizeForWfm(name);

export type LivePrice = { sell_median: number | null; tradeable?: boolean };
export type PriceMap = ReadonlyMap<string, LivePrice>;
export const priceOf = (prices: PriceMap, slug: string): number | null => prices.get(slug)?.sell_median ?? null;

// ── Prime sets ──────────────────────────────────────────────────────────────

const PARENT_CATEGORIES = new Set(["Warframes", "Primary", "Secondary", "Melee", "Companions", "Archwing", "Operator Weapons"]);

export function setName(itemName: string): string {
  const words = itemName.split(" ");
  const prime = words.lastIndexOf("Prime");
  return (prime >= 0 ? words.slice(0, prime + 1) : words.slice(0, 2)).join(" ");
}

export const partLabel = (itemName: string, set: string) => (itemName.startsWith(set) ? itemName.slice(set.length).trim() || itemName : itemName);

export type PrimeSet = { name: string; parent: CatalogItem | null; parts: CatalogItem[] };

/** Five steps: dedupe, blueprints over built parts, inherited ducats, drop exalted. */
export function buildSets(catalog: readonly CatalogItem[]): PrimeSet[] {
  const ducatsByName = new Map<string, number>();
  const parents = new Map<string, CatalogItem>();
  const groups = new Map<string, CatalogItem[]>();
  for (const i of catalog) {
    if (i.ducats != null) ducatsByName.set(i.name, i.ducats);
    if (!i.name.includes("Prime")) continue;
    if (PARENT_CATEGORIES.has(i.category)) parents.set(i.name, i);
    if (i.ducats == null && !i.name.endsWith("Blueprint")) continue;
    const key = setName(i.name);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const sets: PrimeSet[] = [];
  for (const [key, items] of groups) {
    const byLabel = new Map<string, CatalogItem>();
    for (const part of items) {
      const label = partLabel(part.name, key);
      const existing = byLabel.get(label);
      if (!existing || (part.ducats != null && existing.ducats == null)) byLabel.set(label, part);
    }
    const builtWithBlueprint = new Set(
      [...byLabel.keys()].filter((l) => l.endsWith("Blueprint") && l !== "Blueprint").map((l) => l.replace(/ Blueprint$/, "")),
    );
    const parts = [...byLabel.values()]
      .filter((p) => !builtWithBlueprint.has(partLabel(p.name, key)))
      .map((p) => {
        if (p.ducats != null || !p.name.endsWith("Blueprint")) return p;
        const base = p.name.replace(/ Blueprint$/, "");
        const ducats = ducatsByName.get(base) ?? ducatsByName.get(`${key} ${base.slice(key.length).trim()}`);
        return ducats != null ? { ...p, ducats } : p;
      })
      .filter((p) => p.ducats != null);
    if (parts.length > 0) sets.push({ name: key, parent: parents.get(key) ?? null, parts });
  }
  return sets;
}

/** Most of each component any recipe needs (Aksomati Prime: 2× Barrel). */
export function requiredCounts(recipes: Iterable<readonly RecipeComponent[]>): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (comps: readonly RecipeComponent[], multiplier: number) => {
    for (const c of comps) {
      const total = multiplier * c.count;
      out.set(c.unique_name, Math.max(out.get(c.unique_name) ?? 0, total));
      if (c.components.length > 0) walk(c.components, total);
    }
  };
  for (const r of recipes) walk(r, 1);
  return out;
}

export type MarketFilters = {
  search: string;
  ownership: Array<"owned" | "notowned">;
  conditions: Array<"dupes" | "itemowned" | "fullset" | "hasparts">;
  vault: Array<"vaulted" | "unvaulted">;
  sortMode: "plat" | "ducats" | "az" | "za";
  activeMarketTab: "trading" | "sets" | "mods" | "rivens" | "sisters";
};

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  search: "",
  ownership: [],
  conditions: [],
  vault: [],
  sortMode: "ducats",
  activeMarketTab: "trading",
};

export const toggleIn = <T>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export type SetContext = {
  own: Ownership;
  required: ReadonlyMap<string, number>;
  lookup: ReadonlyMap<string, string>;
  prices: PriceMap;
};

const qty = (own: Ownership, id: string) => own.quantities[id] ?? 0;
const need = (ctx: SetContext, id: string) => ctx.required.get(id) ?? 1;

export type SetSummary = {
  owned: number;
  complete: boolean;
  dupes: boolean;
  itemOwned: boolean;
  vaulted: boolean;
  ducats: number;
  slug: string;
  price: number | null;
};

export function summarizeSet(set: PrimeSet, ctx: SetContext): SetSummary {
  const owned = set.parts.filter((p) => qty(ctx.own, p.unique_name) > 0).length;
  const slug = slugFor(ctx.lookup, `${set.name} Set`);
  return {
    owned,
    complete: owned === set.parts.length,
    dupes: set.parts.some((p) => qty(ctx.own, p.unique_name) > need(ctx, p.unique_name)),
    itemOwned: set.parent !== null && qty(ctx.own, set.parent.unique_name) > 0,
    vaulted: set.parent ? set.parent.vaulted === true : set.parts.some((p) => p.vaulted === true),
    ducats: set.parts.reduce((s, p) => s + (p.ducats ?? 0) * qty(ctx.own, p.unique_name), 0),
    slug,
    price: priceOf(ctx.prices, slug),
  };
}

export function visibleSets(sets: readonly PrimeSet[], f: MarketFilters, ctx: SetContext): Array<{ set: PrimeSet; summary: SetSummary }> {
  const terms = splitSearchTerms(f.search);
  const rows = sets
    .filter((s) => matchesTerms(terms, s.name))
    .map((set) => ({ set, summary: summarizeSet(set, ctx) }))
    .filter(({ summary: s }) => {
      if (f.ownership.length === 1) {
        if (f.ownership[0] === "owned" ? !s.itemOwned : s.itemOwned) return false;
      }
      if (f.conditions.length > 0) {
        const ok = f.conditions.some(
          (c) =>
            (c === "hasparts" && s.owned > 0) || (c === "dupes" && s.dupes) || (c === "fullset" && s.complete) || (c === "itemowned" && s.itemOwned),
        );
        if (!ok) return false;
      }
      if (f.vault.length === 1) {
        if (f.vault[0] === "vaulted" ? !s.vaulted : s.vaulted) return false;
      }
      return true;
    });
  const byName = (a: { set: PrimeSet }, b: { set: PrimeSet }) => a.set.name.localeCompare(b.set.name);
  return rows.sort((a, b) => {
    switch (f.sortMode) {
      case "ducats":
        return b.summary.ducats - a.summary.ducats || byName(a, b);
      case "plat":
        return (b.summary.price ?? 0) - (a.summary.price ?? 0) || byName(a, b);
      case "za":
        return byName(b, a);
      default:
        return byName(a, b);
    }
  });
}

/** Parts sorted by quantity, then name, with what the card shows. */
export function setParts(set: PrimeSet, ctx: SetContext) {
  return [...set.parts]
    .sort((a, b) => qty(ctx.own, b.unique_name) - qty(ctx.own, a.unique_name) || a.name.localeCompare(b.name))
    .map((item) => {
      const slug = slugFor(ctx.lookup, item.name);
      return {
        item,
        label: partLabel(item.name, set.name),
        qty: qty(ctx.own, item.unique_name),
        required: need(ctx, item.unique_name),
        slug,
        price: priceOf(ctx.prices, slug),
      };
    });
}

/** Ducats of every owned part, and of copies above what the recipes need. */
export function ducatTotals(sets: readonly PrimeSet[], ctx: SetContext): { total: number; dupes: number } {
  let total = 0;
  let dupes = 0;
  for (const s of sets) {
    for (const p of s.parts) {
      const q = qty(ctx.own, p.unique_name);
      total += (p.ducats ?? 0) * q;
      dupes += (p.ducats ?? 0) * Math.max(0, q - need(ctx, p.unique_name));
    }
  }
  return { total, dupes };
}

/** Slugs to queue: owned sets first, each set's slug before its parts. */
export function queueOrder(sets: readonly PrimeSet[], ctx: Omit<SetContext, "prices" | "required">): string[] {
  const owned: string[] = [];
  const unowned: string[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    const target = s.parts.some((p) => qty(ctx.own, p.unique_name) > 0) ? owned : unowned;
    for (const slug of [slugFor(ctx.lookup, `${s.name} Set`), ...s.parts.map((p) => slugFor(ctx.lookup, p.name))]) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      target.push(slug);
    }
  }
  return [...owned, ...unowned];
}

// ── Mods & Arcanes ──────────────────────────────────────────────────────────

export type ModFilters = {
  search: string;
  /** Navigator entry: an id from MOD_GROUPS (domain/items.ts). */
  group: string;
  /** Only what you own. */
  owned: boolean;
  /** Only mods you own with no copy at the max rank yet. */
  incomplete: boolean;
  sort: "qty" | "plat" | "az" | "za";
  /** Rarities to show (any of them); empty shows every rarity. */
  rarity: readonly string[];
  /** Polarities to show, lower case as WFCD writes them; empty shows all. */
  polarity: readonly string[];
  /** Augment and exilus mods only (any of them); empty shows every mod. */
  traits: readonly ModTrait[];
  /** Owned ranks to show (any of them); empty shows every rank. */
  ranks: readonly ModRankFilter[];
};

export type ModTrait = "augment" | "exilus";

export const DEFAULT_MOD_FILTERS: ModFilters = {
  search: "",
  group: "all",
  owned: false,
  incomplete: false,
  sort: "qty",
  rarity: [],
  polarity: [],
  traits: [],
  ranks: [],
};

/** How many of the popover filters (rarity, polarity, traits, ranks) are set. */
export const activeModFilterCount = (f: ModFilters) => f.rarity.length + f.polarity.length + f.traits.length + f.ranks.length;

/** A mod or arcane the Mods & Arcanes screen lists. */
export const isModOrArcane = (i: CatalogItem) => i.category === "Mods" || i.category === "Arcanes";

/** Owned and total items per navigator entry of Mods & Arcanes. */
export function modGroupCounts(
  catalog: readonly CatalogItem[],
  ctx: { own: Ownership; mods: ModCounts; meta: Readonly<Record<string, CardMeta>> },
): { owned: Record<string, number>; total: Record<string, number> } {
  const owned: Record<string, number> = {};
  const total: Record<string, number> = {};
  for (const i of catalog) {
    if (!isModOrArcane(i)) continue;
    const has = modQty(ctx.own, ctx.mods, i.unique_name) > 0;
    for (const key of modGroups(i, ctx.meta[i.unique_name])) {
      total[key] = (total[key] ?? 0) + 1;
      if (has) owned[key] = (owned[key] ?? 0) + 1;
    }
  }
  return { owned, total };
}

/** Owned copies: the scanner's mod total counts too. */
export const modQty = (own: Ownership, mods: ModCounts, id: string) => Math.max(own.quantities[id] ?? 0, mods[id]?.total ?? 0);

export function visibleMods(
  catalog: readonly CatalogItem[],
  f: ModFilters,
  ctx: { own: Ownership; mods: ModCounts; lookup: ReadonlyMap<string, string>; prices: PriceMap; meta: Readonly<Record<string, CardMeta>> },
): CatalogItem[] {
  const q = f.search.trim().toLowerCase();
  const price = (i: CatalogItem) => {
    const slug = ctx.lookup.get(normalizeForWfm(i.name));
    return slug ? (priceOf(ctx.prices, slug) ?? 0) : 0;
  };
  const count = (i: CatalogItem) => modQty(ctx.own, ctx.mods, i.unique_name);
  return catalog
    .filter((i) => {
      if (!isModOrArcane(i)) return false;
      const meta = ctx.meta[i.unique_name];
      if (!inModGroup(f.group, i, meta)) return false;
      if (q && !matchMod(q, modDisplayName(i), meta).matched) return false;
      if (f.rarity.length > 0 && !f.rarity.includes(meta?.rarity ?? "")) return false;
      if (f.polarity.length > 0 && !f.polarity.includes(meta?.polarity ?? "")) return false;
      if (f.traits.length > 0 && !f.traits.some((t) => (t === "exilus" ? isExilusMod(meta) : meta?.augment === true))) return false;
      if (f.ranks.length > 0) {
        const byRank = ctx.mods[i.unique_name]?.by_rank ?? {};
        if (!f.ranks.some((r) => (byRank[r === "unranked" ? "0" : String(r)] ?? 0) > 0)) return false;
      }
      if (f.owned && count(i) === 0) return false;
      if (f.incomplete && !isIncomplete(ctx.mods[i.unique_name]?.by_rank, meta?.max_rank)) return false;
      return true;
    })
    .sort((a, b) => {
      if (f.sort === "qty") return count(b) - count(a) || a.name.localeCompare(b.name);
      if (f.sort === "plat") return price(b) - price(a) || a.name.localeCompare(b.name);
      if (f.sort === "za") return b.name.localeCompare(a.name);
      return a.name.localeCompare(b.name);
    });
}

/** Ranks with copies, highest first. */
export function rankCopies(mods: ModCounts, id: string): Array<{ rank: number; count: number }> {
  return Object.entries(mods[id]?.by_rank ?? {})
    .filter(([, count]) => count > 0)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.rank - a.rank);
}

// ── Item window ─────────────────────────────────────────────────────────────

export type WfmStatPoint = { datetime: string; median: number; volume: number };
export type WfmPublicOrder = {
  id?: string;
  platinum: number;
  quantity: number;
  user: { ingameName: string; reputation: number; status: string };
  mod_rank?: number;
};
export type WfmItemOrders = { sell: WfmPublicOrder[]; buy: WfmPublicOrder[] };
export type WfmItemInfo = { id: string; modMaxRank?: number };

/** The "48h median" is the second-to-last statistics point. */
export const median48h = (stats: readonly WfmStatPoint[]): number | null => stats.slice(-2)[0]?.median ?? null;

export type Sparkline = { points: string; area: string; low: number; high: number; last: number };

/** Last 21 points (three weeks) as SVG coordinates in a 320×56 box. */
export function sparkline(stats: readonly WfmStatPoint[], width = 320, height = 56): Sparkline | null {
  const pts = stats.slice(-21).map((s) => s.median);
  if (pts.length < 2) return null;
  const min = Math.min(...pts) * 0.97;
  const max = Math.max(...pts) * 1.03;
  const range = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (p: number) => height - ((p - min) / range) * height;
  const points = pts.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  return {
    points,
    area: `0,${String(height)} ${points} ${String(width)},${String(height)}`,
    low: Math.min(...pts),
    high: Math.max(...pts),
    last: pts[pts.length - 1] ?? 0,
  };
}

export const statusLabel = (status: string) => (status === "ingame" ? "In game" : status === "online" ? "Online" : "Offline");

/** Seller rows → you buy; buyer rows → you sell. */
export function whisper(order: WfmPublicOrder, side: "sell" | "buy", itemName: string): string {
  const action = side === "sell" ? "buy" : "sell";
  return `/w ${order.user.ingameName} Hi! I want to ${action}: "${itemName}" for ${String(order.platinum)} platinum. (warframe.market)`;
}

/** Price the order form starts with: best order on that side, else the 48h median; whole platinum. */
export function prefillPrice(side: "sell" | "buy", orders: WfmItemOrders | undefined, median: number | null): number {
  const best = side === "sell" ? orders?.sell[0]?.platinum : orders?.buy[0]?.platinum;
  return Math.round(best ?? median ?? 0);
}

// ── Presets ─────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isList = (v: unknown, allowed: readonly string[]) => Array.isArray(v) && v.every((x) => typeof x === "string" && allowed.includes(x));

/** Validates a stored Market preset; the open tab is not part of a preset. */
export function marketPresetCodec(activeMarketTab: MarketFilters["activeMarketTab"]): PresetCodec<MarketFilters> {
  return {
    module: "market",
    decode: (v) => {
      if (!isRecord(v) || typeof v.search !== "string") return null;
      if (!isList(v.ownership, ["owned", "notowned"]) || !isList(v.conditions, ["dupes", "itemowned", "fullset", "hasparts"])) return null;
      if (!isList(v.vault, ["vaulted", "unvaulted"]) || !["plat", "ducats", "az", "za"].includes(v.sortMode as string)) return null;
      return {
        search: v.search,
        ownership: v.ownership as MarketFilters["ownership"],
        conditions: v.conditions as MarketFilters["conditions"],
        vault: v.vault as MarketFilters["vault"],
        sortMode: v.sortMode as MarketFilters["sortMode"],
        activeMarketTab,
      };
    },
    encode: (f) => {
      const stored: Partial<MarketFilters> = { ...f };
      delete stored.activeMarketTab;
      return stored;
    },
  };
}

/** What opens the item window: a set, a part, or a mod (optionally at a rank). */
export type MarketTarget = {
  slug: string;
  name: string;
  imageName: string | null;
  rank: number | null;
  /** Set when editing one of my listings (Trading): the window saves instead of posting. */
  edit?: { orderId: string; platinum: number; quantity: number; visible: boolean };
};
