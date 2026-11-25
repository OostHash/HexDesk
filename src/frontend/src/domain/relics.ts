import type { Ownership } from "./completionist.ts";
import type { PresetCodec } from "./filterPresets.ts";

/**
 * Relic logic, including the "Avg Plat" sort.
 */

// ── Catalogue ───────────────────────────────────────────────────────────────

/** Item from get_all_items. Optional fields are null when the catalogue has no value. */
export type CatalogItem = {
  unique_name: string;
  name: string;
  category: string;
  image_name?: string | null;
  vaulted?: boolean | null;
  ducats?: number | null;
  mastery_req?: number | null;
  max_level_cap?: number | null;
  /** Whether levelling the item counts towards mastery. */
  masterable?: boolean | null;
};

export type CatalogIndex = {
  byName: ReadonlyMap<string, CatalogItem>;
  /** Relics per refinement, keyed "meso v13 intact". */
  relics: ReadonlyMap<string, CatalogItem>;
};

export function buildCatalogIndex(items: readonly CatalogItem[]): CatalogIndex {
  const byName = new Map<string, CatalogItem>();
  const relics = new Map<string, CatalogItem>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    byName.set(key, item);
    if (item.category === "Relics") relics.set(key, item);
  }
  return { byName, relics };
}

// ── Drop data ───────────────────────────────────────────────────────────────

export const RARITIES = ["Common", "Uncommon", "Rare"] as const;
export type Rarity = (typeof RARITIES)[number];

export const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"] as const;
export type Refinement = (typeof REFINEMENTS)[number];

export const REFINEMENT_LABEL: Readonly<Record<Refinement, string>> = {
  intact: "Intact",
  exceptional: "Exceptional",
  flawless: "Flawless",
  radiant: "Radiant",
};

/** Chance per reward of a rarity, per refinement. */
export const DROP_RATES: Readonly<Record<Refinement, Readonly<Record<Rarity, number>>>> = {
  intact: { Common: 0.2533, Uncommon: 0.11, Rare: 0.02 },
  exceptional: { Common: 0.2333, Uncommon: 0.13, Rare: 0.04 },
  flawless: { Common: 0.2, Uncommon: 0.17, Rare: 0.06 },
  radiant: { Common: 0.1667, Uncommon: 0.2, Rare: 0.1 },
};

export const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"] as const;

export type DropReward = { itemName: string; chance: number; rarity: Rarity };
export type RelicDrop = { tier: string; relicName: string; fullName: string; rewards: DropReward[] };

/** Rarity from the drop chance; the data's own rarity string is unreliable. */
export function chanceToRarity(chance: number): Rarity {
  if (chance >= 15) return "Common";
  if (chance >= 5) return "Uncommon";
  return "Rare";
}

type RawReward = { itemName?: unknown; item_name?: unknown; name?: unknown; chance?: unknown };
type RawRelic = { state?: unknown; relicName?: unknown; name?: unknown; tier?: unknown; rewards?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Intact relics from get_drop_data, rewards sorted Common → Rare. */
export function parseDropData(raw: unknown): RelicDrop[] {
  const relics = (raw as { relics?: unknown } | null)?.relics;
  if (!Array.isArray(relics)) return [];
  const byName = new Map<string, RelicDrop>();
  for (const r of relics as RawRelic[]) {
    if (r.state !== "Intact") continue;
    const relicName = str(r.relicName) || str(r.name);
    if (!relicName) continue;
    const tier = str(r.tier);
    const fullName = tier ? `${tier} ${relicName}` : relicName;
    const rewards = (Array.isArray(r.rewards) ? (r.rewards as RawReward[]) : [])
      .map((x) => {
        const chance = Number(x.chance ?? 0);
        return { itemName: str(x.itemName) || str(x.item_name) || str(x.name), chance, rarity: chanceToRarity(chance) };
      })
      .filter((x) => x.itemName !== "")
      .sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity));
    byName.set(fullName, { tier, relicName, fullName, rewards });
  }
  return [...byName.values()];
}

// ── Ownership ───────────────────────────────────────────────────────────────

const qtyOf = (item: CatalogItem | undefined, own: Ownership) => (item ? (own.quantities[item.unique_name] ?? 0) : 0);

export function refinementCounts(drop: RelicDrop, index: CatalogIndex, own: Ownership): Record<Refinement, number> & { total: number } {
  const base = drop.fullName.toLowerCase();
  const counts = Object.fromEntries(REFINEMENTS.map((r) => [r, qtyOf(index.relics.get(`${base} ${r}`), own)])) as Record<Refinement, number>;
  return { ...counts, total: REFINEMENTS.reduce((sum, r) => sum + counts[r], 0) };
}

export function intactRelic(drop: RelicDrop, index: CatalogIndex): CatalogItem | undefined {
  return index.relics.get(`${drop.fullName.toLowerCase()} intact`);
}

/** One relic that drops an item, with how many of that relic you own. */
export type RelicSource = {
  relic: RelicDrop;
  /** The item's rarity in this relic. */
  rarity: Rarity;
  owned: Record<Refinement, number> & { total: number };
  /** Null when the catalogue does not know the relic's vault status. */
  vaulted: boolean | null;
};

/**
 * Every relic that drops the item named `itemName`: relics you own first, then
 * unvaulted before vaulted, then by name.
 */
export function relicSources(itemName: string, drops: readonly RelicDrop[], index: CatalogIndex, own: Ownership): RelicSource[] {
  const name = itemName.toLowerCase();
  const sources: RelicSource[] = [];
  for (const relic of drops) {
    const reward = relic.rewards.find((r) => r.itemName.toLowerCase() === name);
    if (!reward) continue;
    sources.push({ relic, rarity: reward.rarity, owned: refinementCounts(relic, index, own), vaulted: intactRelic(relic, index)?.vaulted ?? null });
  }
  return sources.sort(
    (a, b) =>
      Number(b.owned.total > 0) - Number(a.owned.total > 0) ||
      Number(a.vaulted === true) - Number(b.vaulted === true) ||
      a.relic.fullName.localeCompare(b.relic.fullName),
  );
}

/** "Burston Prime Barrel" → "Burston Prime". */
export function primeParent(name: string): string | null {
  const i = name.indexOf(" Prime");
  return i >= 0 ? name.slice(0, i + " Prime".length) : null;
}

/**
 * Catalogue item for a reward name: exact, then with/without " Blueprint",
 * then all significant words; borrows the parent prime image when missing.
 */
export function findRewardItem(name: string, index: CatalogIndex): CatalogItem | undefined {
  const n = name.toLowerCase();
  let found =
    index.byName.get(n) ?? (n.endsWith(" blueprint") ? index.byName.get(n.slice(0, -" blueprint".length)) : index.byName.get(`${n} blueprint`));
  if (!found) {
    const words = n
      .replace(" blueprint", "")
      .split(" ")
      .filter((w) => w.length > 2);
    if (words.length >= 2) {
      for (const item of index.byName.values()) {
        if (words.every((w) => item.name.toLowerCase().includes(w))) {
          found = item;
          break;
        }
      }
    }
  }
  if (found && !found.image_name) {
    const parent = primeParent(name);
    const parentItem = parent ? index.byName.get(parent.toLowerCase()) : undefined;
    if (parentItem?.image_name) return { ...found, image_name: parentItem.image_name };
  }
  return found;
}

export const isFormaOrKuva = (name: string) => name.includes("Forma") || name === "Kuva";

export type RewardState = { owned: boolean; complete: boolean };

/**
 * owned: the item (or, for a blueprint, the built item) is in the inventory.
 * complete: the parent prime item is owned or mastered (rank 30); Forma and
 * Kuva count as complete when ignoreFormaKuva is set.
 */
export function rewardState(reward: DropReward, index: CatalogIndex, own: Ownership, ignoreFormaKuva: boolean): RewardState {
  const item = findRewardItem(reward.itemName, index);
  let owned = qtyOf(item, own) > 0;
  if (!owned && item?.name.endsWith(" Blueprint")) {
    owned = qtyOf(index.byName.get(item.name.slice(0, -" Blueprint".length).toLowerCase()), own) > 0;
  }
  if (ignoreFormaKuva && isFormaOrKuva(reward.itemName)) return { owned, complete: true };
  const parentName = primeParent(reward.itemName);
  const parent = parentName ? index.byName.get(parentName.toLowerCase()) : undefined;
  const complete = parent ? qtyOf(parent, own) > 0 || (own.mastery[parent.unique_name] ?? 0) >= 30 : false;
  return { owned, complete };
}

export function relicComplete(drop: RelicDrop, index: CatalogIndex, own: Ownership, ignoreFormaKuva: boolean): boolean {
  return (
    drop.rewards.length > 0 &&
    drop.rewards.every((r) => {
      const s = rewardState(r, index, own, ignoreFormaKuva);
      return s.owned || s.complete;
    })
  );
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Comma-separated terms, OR. */
export function splitSearchTerms(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesTerms(terms: readonly string[], ...values: readonly string[]): boolean {
  return terms.length === 0 || terms.some((t) => values.some((v) => v.toLowerCase().includes(t)));
}

/** Terms long enough to highlight rewards (more than one character). */
export const highlightTerms = (terms: readonly string[]) => terms.filter((t) => t.length > 1);

// ── Prices ──────────────────────────────────────────────────────────────────

export type Metric = "plat" | "ducat";

const wfmNorm = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Platinum price by normalised item name, from WFM items and cached prices. */
export function buildPriceIndex(
  items: ReadonlyArray<{ item_name: string; url_name: string }>,
  prices: Readonly<Record<string, number | null>>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const price = prices[item.url_name];
    if (price !== null && price !== undefined) out.set(wfmNorm(item.item_name), price);
  }
  return out;
}

export function rewardValue(reward: DropReward, metric: Metric, index: CatalogIndex, prices: ReadonlyMap<string, number>): number {
  if (metric === "ducat") return findRewardItem(reward.itemName, index)?.ducats ?? 0;
  return prices.get(wfmNorm(reward.itemName)) ?? 0;
}

/**
 * Expected value of one run. Solo: Σ chance × value. Squad of N: every
 * player draws; you pick the best of the N rewards (all nᴺ combinations).
 */
export function expectedValue(rewards: readonly DropReward[], refinement: Refinement, values: readonly number[], squad: number): number {
  const rates = DROP_RATES[refinement];
  const probs = rewards.map((r) => rates[r.rarity]);
  if (rewards.length === 0) return 0;
  if (squad <= 1) return probs.reduce((sum, p, i) => sum + p * (values[i] ?? 0), 0);
  let ev = 0;
  const walk = (player: number, prob: number, best: number) => {
    if (player === squad) {
      ev += prob * best;
      return;
    }
    probs.forEach((p, i) => {
      walk(player + 1, prob * p, Math.max(best, values[i] ?? 0));
    });
  };
  walk(0, 1, 0);
  return ev;
}

// ── Relics list ─────────────────────────────────────────────────────────────

export type RelicFilters = {
  search: string;
  eras: readonly string[];
  ownership: ReadonlyArray<"owned" | "notowned">;
  vault: ReadonlyArray<"vaulted" | "unvaulted">;
  completion: ReadonlyArray<"complete" | "incomplete">;
  ignoreFormaKuva: boolean;
  sort: "count" | "plat" | "ducats" | "az" | "za";
};

export const DEFAULT_RELIC_FILTERS: RelicFilters = {
  search: "",
  eras: [],
  ownership: [],
  vault: [],
  completion: [],
  ignoreFormaKuva: false,
  sort: "count",
};

export type RelicContext = { index: CatalogIndex; own: Ownership; prices: ReadonlyMap<string, number> };

/** One-or-none of a pair filters; both selected means no filter. */
const pick = <T>(selected: readonly T[], yes: T, matches: boolean) => selected.length !== 1 || (selected[0] === yes ? matches : !matches);

const avgIntact = (drop: RelicDrop, metric: Metric, ctx: RelicContext) =>
  drop.rewards.reduce((sum, r) => sum + rewardValue(r, metric, ctx.index, ctx.prices) * DROP_RATES.intact[r.rarity], 0);

export function filterRelics(drops: readonly RelicDrop[], f: RelicFilters, ctx: RelicContext): RelicDrop[] {
  const terms = splitSearchTerms(f.search);
  const total = (d: RelicDrop) => refinementCounts(d, ctx.index, ctx.own).total;
  const list = drops.filter(
    (d) =>
      d.relicName !== "" &&
      matchesTerms(terms, d.fullName, d.relicName, ...d.rewards.map((r) => r.itemName)) &&
      (f.eras.length === 0 || f.eras.includes(d.tier.toLowerCase())) &&
      pick(f.ownership, "owned", total(d) > 0) &&
      pick(f.vault, "vaulted", intactRelic(d, ctx.index)?.vaulted === true) &&
      pick(f.completion, "complete", relicComplete(d, ctx.index, ctx.own, f.ignoreFormaKuva)),
  );
  const byName = (a: RelicDrop, b: RelicDrop) => a.fullName.localeCompare(b.fullName);
  switch (f.sort) {
    case "count":
      return list.sort((a, b) => total(b) - total(a) || byName(a, b));
    case "ducats":
      return list.sort((a, b) => avgIntact(b, "ducat", ctx) - avgIntact(a, "ducat", ctx) || byName(a, b));
    case "plat":
      return list.sort((a, b) => avgIntact(b, "plat", ctx) - avgIntact(a, "plat", ctx) || byName(a, b));
    case "za":
      return list.sort((a, b) => byName(b, a));
    case "az":
      return list.sort(byName);
  }
}

// ── Planner ─────────────────────────────────────────────────────────────────

export type PlannerOptions = {
  metric: Metric;
  squad: 1 | 2 | 3 | 4;
  eras: readonly string[];
  vault: "all" | "vaulted" | "unvaulted";
  ownedOnly: boolean;
};

export type PlannerRow = {
  drop: RelicDrop;
  values: number[];
  ev: Record<Refinement, number>;
  best: Refinement;
  owned: number;
  vaulted: boolean;
  /** Radiant minus Intact. */
  gain: number;
};

export function plannerRows(drops: readonly RelicDrop[], o: PlannerOptions, ctx: RelicContext): PlannerRow[] {
  return drops
    .filter((d) => {
      if (!d.relicName) return false;
      const vaulted = intactRelic(d, ctx.index)?.vaulted === true;
      if (o.ownedOnly && refinementCounts(d, ctx.index, ctx.own).total === 0) return false;
      if (o.eras.length > 0 && !o.eras.includes(d.tier.toLowerCase())) return false;
      if (o.vault === "vaulted" && !vaulted) return false;
      if (o.vault === "unvaulted" && vaulted) return false;
      return true;
    })
    .map((drop) => {
      const values = drop.rewards.map((r) => rewardValue(r, o.metric, ctx.index, ctx.prices));
      const ev = Object.fromEntries(REFINEMENTS.map((r) => [r, expectedValue(drop.rewards, r, values, o.squad)])) as Record<Refinement, number>;
      const best = REFINEMENTS.reduce<Refinement>((b, r) => (ev[r] > ev[b] ? r : b), "intact");
      return {
        drop,
        values,
        ev,
        best,
        owned: refinementCounts(drop, ctx.index, ctx.own).total,
        vaulted: intactRelic(drop, ctx.index)?.vaulted === true,
        gain: ev.radiant - ev.intact,
      };
    });
}

// ── Presets ─────────────────────────────────────────────────────────────────

const isStringList = (v: unknown, allowed: readonly string[]): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && allowed.includes(x));

/** Stored with stable field names (tiers, sortMode) so saved presets keep working. */
export const relicPresetCodec: PresetCodec<RelicFilters> = {
  module: "relics",
  decode: (v) => {
    if (typeof v !== "object" || v === null) return null;
    const r = v as Record<string, unknown>;
    if (typeof r.search !== "string" || typeof r.ignoreFormaKuva !== "boolean") return null;
    if (!isStringList(r.tiers, ["lith", "meso", "neo", "axi", "requiem"])) return null;
    if (!isStringList(r.ownership, ["owned", "notowned"]) || !isStringList(r.vault, ["vaulted", "unvaulted"])) return null;
    if (!isStringList(r.completion, ["complete", "incomplete"])) return null;
    if (typeof r.sortMode !== "string" || !["count", "plat", "ducats", "az", "za"].includes(r.sortMode)) return null;
    return {
      search: r.search,
      eras: r.tiers,
      ownership: r.ownership as RelicFilters["ownership"],
      vault: r.vault as RelicFilters["vault"],
      completion: r.completion as RelicFilters["completion"],
      ignoreFormaKuva: r.ignoreFormaKuva,
      sort: r.sortMode as RelicFilters["sort"],
    };
  },
  encode: (f) => ({
    search: f.search,
    tiers: f.eras,
    ownership: f.ownership,
    vault: f.vault,
    completion: f.completion,
    sortMode: f.sort,
    ignoreFormaKuva: f.ignoreFormaKuva,
  }),
};
