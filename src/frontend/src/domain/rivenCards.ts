import type { CardMeta, CardRow } from "./items.ts";
import { isRiven, modDisplayName } from "./items.ts";
import type { ModFilters } from "./market.ts";
import { isModOrArcane } from "./market.ts";
import { matchMod } from "./modSearch.ts";
import type { CatalogItem } from "./relics.ts";
import { groupRivens, polarityName, rivenCategory, rivenModName, titleCase, wfmPolarity, type OwnedRiven } from "./rivens.ts";

/**
 * The Rivens entry of Mods & Arcanes. Every riven you own is unique, so it is
 * not a catalogue item: these cards come from the inventory read with
 * `get_rivens`. Veiled rivens only carry their type, so they stay catalogue
 * placeholders with how many you have.
 */

/** A riven reaches rank 8 at most. */
export const RIVEN_MAX_RANK = 8;

/** One owned riven, unlocked (weapon and stats known) or with its challenge revealed. */
export type RivenCard = {
  /** The game's item id; opens the riven in the Rivens screen. */
  id: string;
  /** Catalogue uniqueName of the riven type, for its image and rarity. */
  itemType: string;
  name: string;
  subline: string;
  state: "unlocked" | "revealed";
  rank: number;
  rerolls: number;
  /** Lower case, as the polarity filter writes it; null when unknown. */
  polarity: string | null;
};

export type RivenEntry = { kind: "riven"; riven: RivenCard } | { kind: "veiled"; item: CatalogItem; count: number };

/** Veiled rivens sit under ".../Randomized/Raw..." in the catalogue. */
const isVeiledPlaceholder = (i: CatalogItem) => isModOrArcane(i) && isRiven(i.unique_name) && i.unique_name.includes("/Randomized/Raw");

/** The weapon's name, or the last part of its path when the catalogue does not know it. */
const weaponName = (compat: string, names: ReadonlyMap<string, string>) => names.get(compat) ?? compat.split("/").pop() ?? compat;

/** Cards for the rivens you own, except veiled ones. `names` maps a weapon uniqueName to its name. */
export function ownRivenCards(list: readonly OwnedRiven[], names: ReadonlyMap<string, string>): RivenCard[] {
  const { unlocked, revealed } = groupRivens(list);
  const card = (r: OwnedRiven, state: RivenCard["state"]): RivenCard => {
    const category = rivenCategory(r.item_type);
    const polarity = polarityName(r.polarity);
    const name = state === "unlocked" && r.compat ? `${weaponName(r.compat, names)} ${titleCase(rivenModName(r))}`.trim() : `${category} Riven Mod`;
    return {
      id: r.item_id,
      itemType: r.item_type,
      name,
      subline: [`${category} riven`, polarity].filter((p): p is string => !!p).join(" · "),
      state,
      rank: r.mod_rank,
      rerolls: r.rerolls,
      polarity: r.polarity ? wfmPolarity(r.polarity) : null,
    };
  };
  return [...unlocked.map((r) => card(r, "unlocked")), ...revealed.map((r) => card(r, "revealed"))];
}

/** Veiled rivens you have, per catalogue type. */
export function veiledCounts(list: readonly OwnedRiven[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const r of groupRivens(list).unrevealed) out.set(r.item_type, (out.get(r.item_type) ?? 0) + r.count);
  return out;
}

/** The small table of a riven card. */
export function rivenRows(r: RivenCard): CardRow[] {
  if (r.state === "revealed") return [{ label: "State", value: "Challenge to complete" }];
  return [
    { label: "Rank", value: `${String(r.rank)}/${String(RIVEN_MAX_RANK)}` },
    { label: "Rerolls", value: String(r.rerolls) },
  ];
}

const nameOf = (e: RivenEntry) => (e.kind === "riven" ? e.riven.name : modDisplayName(e.item));
const countOf = (e: RivenEntry) => (e.kind === "riven" ? 1 : e.count);

/**
 * Your rivens and the veiled placeholders, with the Mods & Arcanes filters
 * applied where they mean something for a riven. `price` gives a placeholder's
 * platinum; your own rivens have no market price.
 */
export function visibleRivens(
  catalog: readonly CatalogItem[],
  rivens: readonly RivenCard[],
  veiled: ReadonlyMap<string, number>,
  f: ModFilters,
  ctx: { meta: Readonly<Record<string, CardMeta>>; price: (item: CatalogItem) => number },
): RivenEntry[] {
  const entries: RivenEntry[] = [
    ...rivens.map((riven): RivenEntry => ({ kind: "riven", riven })),
    ...catalog.filter(isVeiledPlaceholder).map((item): RivenEntry => ({ kind: "veiled", item, count: veiled.get(item.unique_name) ?? 0 })),
  ];
  const keep = (e: RivenEntry): boolean => {
    const typeId = e.kind === "riven" ? e.riven.itemType : e.item.unique_name;
    const meta = ctx.meta[typeId];
    const text = e.kind === "riven" ? `${e.riven.name} ${e.riven.subline}` : modDisplayName(e.item);
    if (f.search.trim() && !matchMod(f.search, text, e.kind === "riven" ? undefined : meta).matched) return false;
    if (f.rarity.length > 0 && !f.rarity.includes(meta?.rarity ?? "")) return false;
    // Rivens are neither augments nor exilus mods.
    if (f.traits.length > 0) return false;
    if (e.kind === "veiled") {
      if (f.polarity.length > 0) return false;
      if (f.ranks.length > 0 && !(f.ranks.includes("unranked") && e.count > 0)) return false;
      // A veiled riven cannot be ranked, so it is never incomplete.
      if (f.incomplete) return false;
      return !f.owned || e.count > 0;
    }
    const r = e.riven;
    if (f.polarity.length > 0 && !f.polarity.includes(r.polarity ?? "")) return false;
    if (f.ranks.length > 0 && !f.ranks.some((k) => (k === "unranked" ? r.rank === 0 : k === r.rank))) return false;
    if (f.incomplete && r.rank >= RIVEN_MAX_RANK) return false;
    return true;
  };
  const price = (e: RivenEntry) => (e.kind === "veiled" ? ctx.price(e.item) : 0);
  const byName = (a: RivenEntry, b: RivenEntry) => nameOf(a).localeCompare(nameOf(b), "en");
  return entries.filter(keep).sort((a, b) => {
    if (f.sort === "qty") return countOf(b) - countOf(a) || byName(a, b);
    if (f.sort === "plat") return price(b) - price(a) || byName(a, b);
    if (f.sort === "za") return byName(b, a);
    return byName(a, b);
  });
}

/** Owned and total for the Rivens entry of the navigator. */
export function rivenGroupCount(entries: readonly RivenEntry[]): { owned: number; total: number } {
  return { owned: entries.filter((e) => countOf(e) > 0).length, total: entries.length };
}
