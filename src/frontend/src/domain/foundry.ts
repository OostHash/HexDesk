import type { Ownership } from "./completionist.ts";
import type { PresetCodec } from "./filterPresets.ts";
import type { CatalogItem } from "./relics.ts";
import { matchesTerms, splitSearchTerms } from "./relics.ts";

/**
 * Foundry logic.
 * Filters keep a stable shape, so saved presets stay compatible.
 */

export const FOUNDRY_CATEGORIES = [
  "All",
  "Warframes",
  "Primary",
  "Secondary",
  "Melee",
  "Companions",
  "Archwing",
  "Operator Weapons",
  "Parts",
  "Blueprints",
  "Miscellaneous",
] as const;

/** Craftable item as get_craftable_items returns it. */
export type FoundryItem = CatalogItem & {
  masterable?: boolean | null;
  /** Set for items acquired in-game rather than built. */
  source_type?: string | null;
};

export type RecipeComponent = {
  unique_name: string;
  name: string;
  count: number;
  result_count: number;
  components: RecipeComponent[];
};

export type FoundryFilters = {
  search: string;
  activeCat: string;
  filterPrime: boolean;
  filterNonPrime: boolean;
  filterVaulted: boolean;
  filterUnvaulted: boolean;
  filterMastered: boolean;
  filterUnmastered: boolean;
  filterOwned: boolean;
  filterUnowned: boolean;
  filterReady: boolean;
  filterLvlCap: boolean;
  ignoreFormaKuva: boolean;
};

export const DEFAULT_FOUNDRY_FILTERS: FoundryFilters = {
  search: "",
  activeCat: "All",
  filterPrime: false,
  filterNonPrime: false,
  filterVaulted: false,
  filterUnvaulted: false,
  filterMastered: false,
  filterUnmastered: false,
  filterOwned: false,
  filterUnowned: false,
  filterReady: false,
  filterLvlCap: false,
  ignoreFormaKuva: false,
};

export const PAGE_SIZES = [30, 60, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const pageSizeFrom = (v: unknown): PageSize => ((PAGE_SIZES as readonly unknown[]).includes(v) ? (v as PageSize) : 30);

const LEVELABLE = new Set(["Warframes", "Primary", "Secondary", "Melee", "Companions", "Archwing", "Operator Weapons"]);

/** Max rank: WFCD only sets max_level_cap above 30; levelable items default to 30. */
export function effectiveMaxCap(item: FoundryItem): number | null {
  if (item.max_level_cap != null && item.max_level_cap > 0) return item.max_level_cap;
  return LEVELABLE.has(item.category) ? 30 : null;
}

export const isLichWeapon = (item: { name: string }) => item.name.startsWith("Kuva ") || item.name.startsWith("Tenet ");
const isPrime = (item: FoundryItem) => item.name.includes("Prime") || item.vaulted != null;

/** Owned quantity; Helminth-subsumed warframes count as 0. */
export const ownedQty = (own: Ownership, uniqueName: string) => (own.subsumed.has(uniqueName) ? 0 : (own.quantities[uniqueName] ?? 0));

/** Recipes list the same component twice sometimes (Akbolto: 2× Bolto); sum those. */
export function mergeComponents(components: readonly RecipeComponent[]): RecipeComponent[] {
  const seen = new Map<string, RecipeComponent>();
  for (const c of components) {
    const existing = seen.get(c.unique_name);
    seen.set(c.unique_name, existing ? { ...existing, count: existing.count + c.count } : { ...c });
  }
  return [...seen.values()];
}

/** Every top-level component present in the needed amount. */
export function hasAllParts(recipe: readonly RecipeComponent[] | undefined, own: Ownership): boolean {
  if (!recipe || recipe.length === 0) return false;
  return mergeComponents(recipe).every((c) => ownedQty(own, c.unique_name) >= (c.count || 1));
}

/** Ready to build: not owned yet and every part is there. */
export const isReady = (item: FoundryItem, recipe: readonly RecipeComponent[] | undefined, own: Ownership) =>
  ownedQty(own, item.unique_name) === 0 && hasAllParts(recipe, own);

export function isMastered(item: FoundryItem, own: Ownership): boolean {
  const cap = effectiveMaxCap(item);
  const rank = own.mastery[item.unique_name];
  return rank !== undefined && cap !== null && rank >= cap;
}

/** Filters except "Ready", which needs recipes (see `applyReadyFilter`). */
export function filterItems(items: readonly FoundryItem[], f: FoundryFilters, own: Ownership): FoundryItem[] {
  const terms = splitSearchTerms(f.search);
  return items.filter((i) => {
    if (f.activeCat !== "All" && i.category !== f.activeCat) return false;
    if (!matchesTerms(terms, i.name)) return false;
    if (f.filterPrime && !isPrime(i)) return false;
    if (f.filterNonPrime && isPrime(i)) return false;
    if (f.filterVaulted && i.vaulted !== true) return false;
    if (f.filterUnvaulted && i.vaulted !== false) return false;
    if (f.filterMastered || f.filterUnmastered) {
      if (!i.masterable) return false;
      const rank = own.mastery[i.unique_name] ?? 0;
      const cap = effectiveMaxCap(i) ?? 30;
      if (f.filterMastered ? rank < cap : rank >= cap) return false;
    }
    if (f.filterOwned || f.filterUnowned) {
      if (f.ignoreFormaKuva && (i.name.includes("Forma") || i.name === "Kuva")) {
        if (!f.filterOwned) return false;
      } else {
        const owned = ownedQty(own, i.unique_name) > 0;
        if (f.filterOwned ? !owned : owned) return false;
      }
    }
    if (f.filterLvlCap && !(i.max_level_cap != null && i.max_level_cap > 30)) return false;
    return true;
  });
}

export function applyReadyFilter(
  items: readonly FoundryItem[],
  f: FoundryFilters,
  recipes: ReadonlyMap<string, RecipeComponent[]>,
  own: Ownership,
): FoundryItem[] {
  if (!f.filterReady) return [...items];
  return items.filter((i) => isReady(i, recipes.get(i.unique_name), own));
}

export function categoryCounts(items: readonly FoundryItem[]): Record<string, number> {
  const counts: Record<string, number> = { All: items.length };
  for (const i of items) counts[i.category] = (counts[i.category] ?? 0) + 1;
  return counts;
}

// ── Status pills (Foundry screen) ────────────────────────────────────────────

/** One status at a time, like the in-game Foundry tabs. Building is not a preset field. */
export type FoundryStatus = "all" | "building" | "ready" | "missing" | "unmastered";

export const FOUNDRY_STATUSES: ReadonlyArray<{ id: FoundryStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "building", label: "Building" },
  { id: "ready", label: "Ready to build" },
  { id: "missing", label: "Missing" },
  { id: "unmastered", label: "Unmastered" },
];

/** The pill that matches the filters; "all" when none of the status flags is set. */
export function statusOf(f: FoundryFilters, building: boolean): FoundryStatus {
  if (building) return "building";
  if (f.filterReady) return "ready";
  if (f.filterUnowned) return "missing";
  if (f.filterUnmastered) return "unmastered";
  return "all";
}

/** Sets one status flag and clears the others (Owned and Mastered contradict them). */
export function withStatus(f: FoundryFilters, status: FoundryStatus): FoundryFilters {
  return {
    ...f,
    filterReady: status === "ready",
    filterUnowned: status === "missing",
    filterOwned: status === "missing" ? false : f.filterOwned,
    filterUnmastered: status === "unmastered",
    filterMastered: status === "unmastered" ? false : f.filterMastered,
  };
}

// ── Sorting (Foundry screen) ─────────────────────────────────────────────────

/** Sort orders of the Foundry list. Not part of the filters, so saved presets keep their shape. */
export type FoundrySort = "name-asc" | "name-desc" | "unmastered" | "missing" | "category";

export const FOUNDRY_SORTS: ReadonlyArray<{ id: FoundrySort; label: string }> = [
  { id: "name-asc", label: "Name, A–Z" },
  { id: "name-desc", label: "Name, Z–A" },
  { id: "unmastered", label: "Unmastered first" },
  { id: "missing", label: "Missing first" },
  { id: "category", label: "Category" },
];

export const DEFAULT_FOUNDRY_SORT: FoundrySort = "name-asc";

export const foundrySortFrom = (v: unknown): FoundrySort => (FOUNDRY_SORTS.some((s) => s.id === v) ? (v as FoundrySort) : DEFAULT_FOUNDRY_SORT);

const byName = (a: FoundryItem, b: FoundryItem) => a.name.localeCompare(b.name, "en");

/** Unmastered masterable items, then mastered ones, then items without mastery. */
const masteryRankOf = (item: FoundryItem, own: Ownership) => (!item.masterable ? 2 : isMastered(item, own) ? 1 : 0);

/** A sorted copy; ties are broken by name so the order is stable across inventory updates. */
export function sortItems(items: readonly FoundryItem[], sort: FoundrySort, own: Ownership): FoundryItem[] {
  const key = (item: FoundryItem): number => {
    switch (sort) {
      case "unmastered":
        return masteryRankOf(item, own);
      case "missing":
        return ownedQty(own, item.unique_name) > 0 ? 1 : 0;
      case "category": {
        const index = (FOUNDRY_CATEGORIES as readonly string[]).indexOf(item.category);
        return index === -1 ? FOUNDRY_CATEGORIES.length : index;
      }
      default:
        return 0;
    }
  };
  const sorted = [...items].sort((a, b) => key(a) - key(b) || byName(a, b));
  return sort === "name-desc" ? sorted.reverse() : sorted;
}

/** Items being built: the job is the item or its blueprint. */
export function applyBuildingFilter(
  items: readonly FoundryItem[],
  recipes: ReadonlyMap<string, RecipeComponent[]>,
  jobs: ReadonlyArray<{ unique_name: string }>,
): FoundryItem[] {
  return items.filter((i) => isBuilding(i, recipes.get(i.unique_name), jobs));
}

/** Done: mastered for masterable items, owned for the rest. */
export const isCollected = (item: FoundryItem, own: Ownership) => (item.masterable ? isMastered(item, own) : ownedQty(own, item.unique_name) > 0);

export type Progress = { done: number; total: number };

/** Collected / total per category, plus "All". */
export function categoryProgress(items: readonly FoundryItem[], own: Ownership): Record<string, Progress> {
  const out: Record<string, Progress> = { All: { done: 0, total: 0 } };
  for (const i of items) {
    const done = isCollected(i, own) ? 1 : 0;
    for (const key of ["All", i.category]) {
      const p = (out[key] ??= { done: 0, total: 0 });
      p.done += done;
      p.total += 1;
    }
  }
  return out;
}

export const percent = (p: Progress) => (p.total === 0 ? 0 : Math.floor((p.done / p.total) * 100));

/** Search jumps to All; Lvl > 30 too; Mastered and Unmastered exclude each other. */
export function patchFilters(f: FoundryFilters, patch: Partial<FoundryFilters>): FoundryFilters {
  const next = { ...f, ...patch };
  if (patch.search !== undefined && patch.search !== "") next.activeCat = "All";
  if (patch.activeCat !== undefined) next.search = "";
  if (patch.filterMastered) next.filterUnmastered = false;
  if (patch.filterUnmastered) next.filterMastered = false;
  if (patch.filterLvlCap) next.activeCat = "All";
  if (patch.filterOwned) next.filterUnowned = false;
  if (patch.filterUnowned) next.filterOwned = false;
  return next;
}

// ── Components ──────────────────────────────────────────────────────────────

export type ComponentStatus = "part" | "blueprint" | "none";

export function componentStatus(c: RecipeComponent, own: Ownership): ComponentStatus {
  if (ownedQty(own, c.unique_name) >= (c.count || 1)) return "part";
  const blueprint = c.components[0]?.unique_name;
  if (blueprint && ownedQty(own, blueprint) > 0) return "blueprint";
  return "none";
}

const REFINEMENTS = ["Bronze", "Silver", "Gold", "Platinum"] as const;
const relicBase = (uniqueName: string) => uniqueName.replace(/(Bronze|Silver|Gold|Platinum)$/, "");

/** Names of owned relics (any refinement) that drop this component. */
export function ownedRelicsFor(
  componentUnique: string,
  relicDrops: Readonly<Record<string, readonly string[]>>,
  relicNames: ReadonlyMap<string, string>,
  own: Ownership,
): string[] {
  const names = new Set<string>();
  for (const relic of relicDrops[componentUnique] ?? []) {
    const base = relicBase(relic);
    const owned = REFINEMENTS.find((r) => ownedQty(own, `${base}${r}`) > 0);
    if (!owned) continue;
    names.add(relicNames.get(`${base}${owned}`) ?? relicNames.get(relic) ?? relic.split("/").pop() ?? relic);
  }
  return [...names];
}

// ── Recipe tree ─────────────────────────────────────────────────────────────

export type RecipeTreeStatus = "owned" | "craftable" | "partial" | "missing";

export type RecipeTreeNode = {
  key: string;
  label: string;
  owned: number;
  needed: number;
  status: RecipeTreeStatus;
  children?: RecipeTreeNode[];
};

/**
 * Owned = enough of it; craftable = every direct part is there; partial =
 * some of it or some parts; missing = nothing. Counts are per craft.
 */
export function recipeTree(recipe: readonly RecipeComponent[], own: Ownership, parentKey = ""): RecipeTreeNode[] {
  return mergeComponents(recipe).map((c) => {
    const key = `${parentKey}/${c.unique_name}`;
    const owned = ownedQty(own, c.unique_name);
    const children = c.components.length > 0 ? recipeTree(c.components, own, key) : undefined;
    let status: RecipeTreeStatus;
    if (owned >= c.count) status = "owned";
    else if (children?.every((n) => n.status === "owned")) status = "craftable";
    else if (owned > 0 || children?.some((n) => n.status !== "missing")) status = "partial";
    else status = "missing";
    return { key, label: c.name, owned, needed: c.count, status, ...(children ? { children } : {}) };
  });
}

/** Keys open by default: nodes that are short, up to depth 3. */
export function defaultExpanded(nodes: readonly RecipeTreeNode[], depth = 0): string[] {
  if (depth >= 3) return [];
  return nodes.flatMap((n) => (n.children && n.status !== "owned" ? [n.key, ...defaultExpanded(n.children, depth + 1)] : []));
}

export type Need = { unique_name: string; name: string; needed: number; owned: number };

/** Everything short across the whole tree (leaves and intermediates), A–Z. */
export function shoppingList(recipe: readonly RecipeComponent[], own: Ownership): Need[] {
  const acc = new Map<string, { name: string; needed: number }>();
  const walk = (nodes: readonly RecipeComponent[], multiplier: number) => {
    for (const node of mergeComponents(nodes)) {
      const crafts = Math.ceil((node.count * multiplier) / (node.result_count || 1));
      if (node.components.length > 0) walk(node.components, crafts);
      const prev = acc.get(node.unique_name);
      acc.set(node.unique_name, { name: node.name, needed: (prev?.needed ?? 0) + node.count * multiplier });
    }
  };
  walk(recipe, 1);
  return [...acc.entries()]
    .map(([unique_name, { name, needed }]) => ({ unique_name, name, needed, owned: ownedQty(own, unique_name) }))
    .filter((r) => r.owned < r.needed)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Building: the job path is the item or its blueprint (first recipe component). */
export function isBuilding(item: FoundryItem, recipe: readonly RecipeComponent[] | undefined, jobs: ReadonlyArray<{ unique_name: string }>): boolean {
  const blueprint = recipe?.[0]?.unique_name;
  return jobs.some((j) => j.unique_name === item.unique_name || (blueprint !== undefined && j.unique_name === blueprint));
}

/** Direct wiki page, like the current Foundry (not the search link Inventory uses). */
export function foundryWikiUrl(name: string): string {
  return `https://wiki.warframe.com/w/${name.replace(" Blueprint", "").replace(/\s+/g, "_")}`;
}

// ── Archon Shards ───────────────────────────────────────────────────────────

export type RawShard = { upgrade_type: string; color: string };
export type ArchonShard = { type: string; tauforged: boolean; boost: string | null };

const SHARD_TYPES: ReadonlyArray<[prefix: string, type: string]> = [
  ["ACC_RED", "Crimson"],
  ["ACC_BLUE", "Azure"],
  ["ACC_GREEN", "Viridian"],
  ["ACC_YELLOW", "Amber"],
  ["ACC_PURPLE", "Violet"],
];

/** Shard colour from a colour name or a number 0–9 (5+ = Tauforged). */
export function parseShard(raw: RawShard): ArchonShard {
  let color = raw.color.toUpperCase();
  const numeric = /^\d+$/.test(color);
  if (numeric) color = SHARD_TYPES[Number(color) % 5]?.[0] ?? color;
  const tauforged = color.includes("MYTHIC") || color.includes("TAU") || (numeric && Number(raw.color) >= 5);
  const type = SHARD_TYPES.find(([prefix]) => color.startsWith(prefix))?.[1] ?? "Unknown";
  const segment = raw.upgrade_type.split("/").pop() ?? "";
  const boost = segment
    .replace(/^ArchonCrystalUpgrade(?:Warframe|Companion)?/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
  return { type, tauforged, boost: boost || null };
}

export const shardLabel = (s: ArchonShard) => `${s.tauforged ? "Tauforged " : ""}${s.type}${s.boost ? ` · ${s.boost}` : ""}`;

// ── Presets ─────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const BOOL_KEYS = [
  "filterPrime",
  "filterNonPrime",
  "filterVaulted",
  "filterUnvaulted",
  "filterMastered",
  "filterUnmastered",
  "filterOwned",
  "filterUnowned",
  "filterReady",
  "filterLvlCap",
  "ignoreFormaKuva",
] as const;

/**
 * Presets store everything except the category. Applying one keeps the
 * category that is open now — the
 * screen passes it in through `withCategory`.
 */
export function foundryPresetCodec(activeCat: string): PresetCodec<FoundryFilters> {
  return {
    module: "foundry",
    decode: (v) => {
      if (!isRecord(v) || typeof v.search !== "string" || BOOL_KEYS.some((k) => typeof v[k] !== "boolean")) return null;
      const out = { ...DEFAULT_FOUNDRY_FILTERS, search: v.search, activeCat };
      for (const k of BOOL_KEYS) out[k] = v[k] === true;
      return out;
    },
    encode: (f) => {
      const stored: Partial<FoundryFilters> = { ...f };
      delete stored.activeCat;
      return stored;
    },
  };
}
