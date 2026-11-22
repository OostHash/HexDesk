/**
 * Completionist logic: syndicate/lab item status and weapon mastery.
 * Pure functions.
 */

export type SyndicateItem = {
  unique_name: string;
  name: string;
  category: string;
  image_name?: string;
  tier: string;
  ducats?: number;
  owned: number;
  result_unique?: string;
  result_owned: number;
};

export type SyndicateStore = { name: string; items: SyndicateItem[] };

export type WeaponItem = {
  unique_name: string;
  name: string;
  category: string;
  image_name?: string;
  mastery_req?: number;
  max_level_cap?: number;
};

/** What the player has: owned quantity, mastery rank and Helminth-consumed frames. */
export type Ownership = {
  quantities: Readonly<Record<string, number>>;
  mastery: Readonly<Record<string, number>>;
  subsumed: ReadonlySet<string>;
};

// ── Syndicates ──────────────────────────────────────────────────────────────

export type ItemStatus = "complete" | "blueprint" | "subsumed" | "none";

export const ITEM_STATUS_LABEL: Readonly<Record<ItemStatus, string>> = {
  complete: "Complete",
  blueprint: "Blueprint",
  subsumed: "Helminth",
  none: "Missing",
};

/**
 * Blueprints count as complete when the crafted result is owned (or was
 * consumed by the Helminth); anything else when it is owned itself.
 */
export function itemStatus(item: SyndicateItem, own: Ownership): ItemStatus {
  const qty = own.quantities[item.unique_name] ?? item.owned;
  if (item.result_unique) {
    if (own.subsumed.has(item.result_unique)) return "subsumed";
    const resultQty = own.quantities[item.result_unique] ?? item.result_owned;
    if (resultQty > 0) return "complete";
    return qty > 0 ? "blueprint" : "none";
  }
  if (own.subsumed.has(item.unique_name)) return "subsumed";
  return qty > 0 ? "complete" : "none";
}

export type SyndicateGroup = "main" | "openworld" | "other" | "lab";

export const SYNDICATE_GROUPS: ReadonlyArray<{ id: SyndicateGroup; label: string }> = [
  { id: "main", label: "Main Syndicates" },
  { id: "openworld", label: "Open World" },
  { id: "other", label: "Other" },
  { id: "lab", label: "Research Labs" },
];

export type SyndicateMeta = {
  short: string;
  group: SyndicateGroup;
  /** Domain colour name (theme/domain.ts), used as --ff-tone. */
  tone: string;
  tierOrder: readonly string[];
  /** Tiers the catalogue gets wrong, mapped to the real rank. */
  tierAliases?: Readonly<Record<string, string>>;
};

export const SYNDICATE_META: Readonly<Record<string, SyndicateMeta>> = {
  "Steel Meridian": {
    short: "Meridian",
    group: "main",
    tone: "syndicate-steel-meridian",
    tierOrder: ["Brave", "Valiant", "Defender", "Protector", "General"],
  },
  "Arbiters of Hexis": {
    short: "Arbiters",
    group: "main",
    tone: "syndicate-arbiters-of-hexis",
    tierOrder: ["Principled", "Authentic", "Lawful", "Crusader", "Maxim"],
  },
  "Cephalon Suda": {
    short: "Suda",
    group: "main",
    tone: "syndicate-cephalon-suda",
    tierOrder: ["Competent", "Intriguing", "Intelligent", "Wise", "Genius"],
  },
  "The Perrin Sequence": {
    short: "Perrin",
    group: "main",
    tone: "syndicate-the-perrin-sequence",
    tierOrder: ["Associate", "Senior Associate", "Executive", "Senior Executive", "Partner"],
  },
  "Red Veil": { short: "Red Veil", group: "main", tone: "syndicate-red-veil", tierOrder: ["Respected", "Honored", "Esteemed", "Revered", "Exalted"] },
  "New Loka": {
    short: "New Loka",
    group: "main",
    tone: "syndicate-new-loka",
    tierOrder: ["Humane", "Bountiful", "Benevolent", "Pure", "Flawless"],
    // Spellbound Harvest comes through as "Exalted" (Red Veil's rank 5 name).
    tierAliases: { Exalted: "Flawless" },
  },
  Ostron: {
    short: "Ostron",
    group: "openworld",
    tone: "syndicate-ostron",
    tierOrder: ["Neutral", "Offworlder", "Visitor", "Trusted", "Surah", "Kin"],
  },
  "Solaris United": {
    short: "Solaris",
    group: "openworld",
    tone: "syndicate-solaris-united",
    tierOrder: ["Neutral", "Outworlder", "Rapscallion", "Doer", "Cove", "Old Mate"],
  },
  Entrati: {
    short: "Entrati",
    group: "openworld",
    tone: "syndicate-entrati",
    tierOrder: ["Neutral", "Stranger", "Acquaintance", "Associate", "Friend", "Family"],
  },
  Necraloid: {
    short: "Necraloid",
    group: "openworld",
    tone: "syndicate-necraloid",
    tierOrder: ["Clearance Agnesis", "Clearance Modus", "Clearance Odima"],
  },
  "The Holdfasts": {
    short: "Holdfasts",
    group: "openworld",
    tone: "syndicate-the-holdfasts",
    tierOrder: ["Neutral", "Fallen", "Watcher", "Guardian", "Seraph", "Angel"],
  },
  "Kahl's Garrison": {
    short: "Garrison",
    group: "openworld",
    tone: "syndicate-kahl-s-garrison",
    tierOrder: ["Encampment", "Fort", "Settlement", "Home"],
  },
  Cavia: { short: "Cavia", group: "openworld", tone: "syndicate-cavia", tierOrder: [] },
  "Bio Lab": {
    short: "Bio",
    group: "lab",
    tone: "syndicate-bio-lab",
    tierOrder: ["Primary", "Secondary", "Melee", "Companions", "Resources", "Misc"],
  },
  "Chem Lab": { short: "Chem", group: "lab", tone: "syndicate-chem-lab", tierOrder: ["Primary", "Secondary", "Melee", "Resources", "Misc"] },
  "Energy Lab": {
    short: "Energy",
    group: "lab",
    tone: "syndicate-energy-lab",
    tierOrder: ["Primary", "Secondary", "Melee", "Companions", "Resources", "Misc"],
  },
  "Tenno Lab": {
    short: "Tenno",
    group: "lab",
    tone: "syndicate-tenno-lab",
    tierOrder: ["Warframes", "Archwing", "Parts", "Primary", "Secondary", "Melee", "Resources", "Misc", "Blueprints"],
  },
  "Orokin Lab": { short: "Orokin", group: "lab", tone: "syndicate-orokin-lab", tierOrder: ["Misc"] },
  "Ventkids Bash Lab": {
    short: "Ventkids",
    group: "lab",
    tone: "syndicate-ventkids-bash-lab",
    tierOrder: ["Warframes", "Parts", "Melee", "Blueprints", "Misc"],
  },
  "Dry Docks": { short: "Dry Dock", group: "lab", tone: "syndicate-dry-docks", tierOrder: ["Misc"] },
  "Dagath's Hollow": { short: "Dagath", group: "lab", tone: "syndicate-dagath-s-hollow", tierOrder: ["Warframes", "Parts", "Melee", "Blueprints"] },
  "The Quills": {
    short: "Quills",
    group: "other",
    tone: "syndicate-the-quills",
    tierOrder: ["Neutral", "Mote", "Observer", "Adherent", "Instrument", "Architect"],
  },
  "Vox Solaris": {
    short: "Vox Sol.",
    group: "other",
    tone: "syndicate-vox-solaris",
    tierOrder: ["Neutral", "Operative", "Agent", "Hand", "Instrument", "Shadow"],
  },
  Ventkids: {
    short: "Ventkids",
    group: "other",
    tone: "syndicate-ventkids",
    tierOrder: ["Neutral", "Glinty", "Whozit", "Proper Felon", "Primo", "Logical"],
  },
  "Cephalon Simaris": { short: "Simaris", group: "other", tone: "syndicate-cephalon-simaris", tierOrder: [] },
  Conclave: { short: "Conclave", group: "other", tone: "syndicate-conclave", tierOrder: ["Mistral", "Whirlwind", "Tempest", "Hurricane", "Typhoon"] },
  "Operational Supply": {
    short: "Op Supply",
    group: "other",
    tone: "syndicate-operational-supply",
    tierOrder: ["Neutral", "Collaborator", "Defender", "Champion"],
  },
};

export const syndicateGroup = (name: string): SyndicateGroup => SYNDICATE_META[name]?.group ?? "other";

export type TierGroup = { tier: string; merchant: string | null; rank: string; items: SyndicateItem[]; complete: number };

/**
 * Open-world stores sell per merchant: the tier reads "(Hok), Neutral".
 * Split into merchant and rank; other tiers have no merchant.
 */
export function splitTier(tier: string): { merchant: string | null; rank: string } {
  const m = /^\((.+?)\),\s*(.+)$/.exec(tier);
  return m ? { merchant: m[1] ?? null, rank: m[2] ?? tier } : { merchant: null, rank: tier };
}

/**
 * Items of one store grouped by tier in the syndicate's tier order (unknown
 * tiers after), sorted by name, filtered by search (name or category) and
 * optionally to items that are not complete.
 */
export function groupByTier(store: SyndicateStore, own: Ownership, filter: { search: string; missingOnly: boolean }): TierGroup[] {
  const q = filter.search.trim().toLowerCase();
  const order = SYNDICATE_META[store.name]?.tierOrder ?? [];
  const aliases = SYNDICATE_META[store.name]?.tierAliases ?? {};
  const tierOf = (item: SyndicateItem) => aliases[item.tier] ?? item.tier;
  const groups = new Map<string, SyndicateItem[]>();
  for (const item of store.items) {
    if (filter.missingOnly && itemStatus(item, own) === "complete") continue;
    if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) continue;
    const tier = tierOf(item);
    const list = groups.get(tier) ?? [];
    list.push(item);
    groups.set(tier, list);
  }
  // Merchants in store order; within a merchant, ranks in the syndicate's tier order (unknown ranks after).
  const merchants: Array<string | null> = [];
  for (const item of store.items) {
    const { merchant } = splitTier(tierOf(item));
    if (!merchants.includes(merchant)) merchants.push(merchant);
  }
  const rankIndex = (rank: string) => {
    const i = order.indexOf(rank);
    return i === -1 ? order.length : i;
  };
  const tiers = [...groups.keys()]
    .map((tier, seen) => ({ tier, seen, ...splitTier(tier) }))
    .sort((a, b) => merchants.indexOf(a.merchant) - merchants.indexOf(b.merchant) || rankIndex(a.rank) - rankIndex(b.rank) || a.seen - b.seen);
  return tiers.map(({ tier, merchant, rank }) => {
    const items = (groups.get(tier) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return { tier, merchant, rank, items, complete: items.filter((i) => itemStatus(i, own) === "complete").length };
  });
}

/**
 * In-game standing rank needed for a tier, for the R badge. Ranks lists that
 * start at Neutral count from 0; the main syndicates' lists start at rank 1.
 * Research labs sell by category, not rank: null, like unknown tiers.
 */
export function rankNumber(storeName: string, rank: string): number | null {
  const meta = SYNDICATE_META[storeName];
  if (!meta || meta.group === "lab") return null;
  const i = meta.tierOrder.indexOf(rank);
  if (i === -1) return null;
  return meta.tierOrder[0] === "Neutral" ? i : i + 1;
}

export function storeProgress(store: SyndicateStore, own: Ownership): { complete: number; total: number } {
  return { complete: store.items.filter((i) => itemStatus(i, own) === "complete").length, total: store.items.length };
}

// ── Weapons ─────────────────────────────────────────────────────────────────

export const WEAPON_TABS = ["Primary", "Secondary", "Melee", "Operator"] as const;
export type WeaponTab = (typeof WEAPON_TABS)[number];

const TAB_CATEGORY: Readonly<Record<WeaponTab, string>> = {
  Primary: "Primary",
  Secondary: "Secondary",
  Melee: "Melee",
  Operator: "Operator Weapons",
};

const GROUP_ORDER = ["Standard", "Zaw", "Prime", "Kuva", "Tenet", "Coda", "Wraith", "Vandal", "Prisma", "MK1"];
const LEVELABLE = new Set(Object.values(TAB_CATEGORY));

export function weaponGroup(item: WeaponItem): string {
  if (item.unique_name.includes("/Ostron/Melee/")) return "Zaw";
  const n = item.name;
  if (n.startsWith("MK1-")) return "MK1";
  if (n.startsWith("Kuva ")) return "Kuva";
  if (n.startsWith("Tenet ")) return "Tenet";
  if (n.startsWith("Coda ")) return "Coda";
  if (n.includes("Prime")) return "Prime";
  if (n.includes("Wraith")) return "Wraith";
  if (n.includes("Vandal")) return "Vandal";
  if (n.includes("Prisma")) return "Prisma";
  return "Standard";
}

/** Maximum rank: the catalogue's cap, else 30 for levelable categories, else 0. */
export function maxRank(item: WeaponItem): number {
  if (item.max_level_cap !== undefined && item.max_level_cap > 0) return item.max_level_cap;
  return LEVELABLE.has(item.category) ? 30 : 0;
}

export type WeaponEntry = { item: WeaponItem; rank: number; max: number; mastered: boolean };
export type WeaponGroup = { group: string; entries: WeaponEntry[] };

/** Weapons of a tab, grouped and filtered, with the tab's mastery progress (before filtering). */
export function weaponView(
  weapons: readonly WeaponItem[],
  tab: WeaponTab,
  mastery: Readonly<Record<string, number>>,
  filter: { search: string; unmasteredOnly: boolean },
): { groups: WeaponGroup[]; mastered: number; total: number } {
  const q = filter.search.trim().toLowerCase();
  const byGroup = new Map<string, WeaponEntry[]>();
  let mastered = 0;
  let total = 0;
  for (const item of weapons) {
    if (item.category !== TAB_CATEGORY[tab]) continue;
    const rank = mastery[item.unique_name] ?? 0;
    const max = maxRank(item);
    const isMastered = max > 0 && rank >= max;
    total++;
    if (isMastered) mastered++;
    if (filter.unmasteredOnly && isMastered) continue;
    if (q && !item.name.toLowerCase().includes(q)) continue;
    const group = weaponGroup(item);
    const list = byGroup.get(group) ?? [];
    list.push({ item, rank, max, mastered: isMastered });
    byGroup.set(group, list);
  }
  const order = [...GROUP_ORDER.filter((g) => byGroup.has(g)), ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g))];
  const groups = order.map((group) => ({
    group,
    entries: (byGroup.get(group) ?? []).sort((a, b) => a.item.name.localeCompare(b.item.name)),
  }));
  return { groups, mastered, total };
}
