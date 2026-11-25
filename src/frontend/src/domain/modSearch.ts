import type { CardMeta } from "./items.ts";

/**
 * Search for Mods & Arcanes. A query matches when the whole query is part of
 * the name, or when every word matches something about the item: its name,
 * a damage type, what it fits, polarity, rarity, type or effect text.
 */

/**
 * Combined elements and the two primary elements that build them
 * (https://wiki.warframe.com/w/Damage). Searching a combined element also
 * finds the mods that add one of its parts, the way the game's mod search does.
 */
export const COMBINED_ELEMENTS: Readonly<Record<string, readonly [string, string]>> = {
  Blast: ["Heat", "Cold"],
  Corrosive: ["Electricity", "Toxin"],
  Gas: ["Heat", "Toxin"],
  Magnetic: ["Cold", "Electricity"],
  Radiation: ["Heat", "Electricity"],
  Viral: ["Cold", "Toxin"],
};

const DAMAGE_TYPES = [
  "Impact",
  "Puncture",
  "Slash",
  "Heat",
  "Cold",
  "Electricity",
  "Toxin",
  "Blast",
  "Corrosive",
  "Gas",
  "Magnetic",
  "Radiation",
  "Viral",
  "Void",
  "Tau",
] as const;

/** Shortest word that may stand for a damage type ("vir" for Viral). */
const MIN_PREFIX = 3;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The damage type a search word names, by its start; null when none or too short. */
function damageTypeFor(word: string): string | null {
  if (word.length < MIN_PREFIX) return DAMAGE_TYPES.find((t) => t.toLowerCase() === word) ?? null;
  return DAMAGE_TYPES.find((t) => t.toLowerCase().startsWith(word)) ?? null;
}

/** Why one word matched, or undefined when it did not; null means the name. */
function matchWord(word: string, name: string, meta: CardMeta | undefined): string | null | undefined {
  if (name.toLowerCase().includes(word)) return null;
  if (!meta) return undefined;
  const element = damageTypeFor(word);
  if (element) {
    if (meta.damage_types.includes(element)) return element;
    const parts = COMBINED_ELEMENTS[element];
    const part = parts?.find((p) => meta.damage_types.includes(p));
    if (part) return `${part}, builds ${element}`;
  }
  if (meta.compat?.toLowerCase().includes(word)) return `Fits ${meta.compat}`;
  if (meta.polarity?.startsWith(word)) return `${capitalize(meta.polarity)} polarity`;
  if (meta.rarity?.toLowerCase().startsWith(word)) return meta.rarity;
  if (meta.augment && "augment".startsWith(word)) return "Augment";
  if (meta.exilus && "exilus".startsWith(word)) return "Exilus";
  if (meta.utility && "utility".startsWith(word)) return "Utility";
  if (meta.type_name.toLowerCase().includes(word)) return meta.type_name;
  const line = meta.effect.find((l) => l.toLowerCase().includes(word));
  if (line) return line;
  return undefined;
}

/**
 * Whether an item matches a search, and why. `matched: false` leaves it out.
 * `reason` is null when the name explains the match, otherwise what matched,
 * one entry per word, such as "Cold, builds Viral".
 */
export function matchMod(query: string, name: string, meta: CardMeta | undefined): { matched: boolean; reason: string | null } {
  const q = query.trim().toLowerCase();
  if (!q || name.toLowerCase().includes(q)) return { matched: true, reason: null };
  const reasons: string[] = [];
  for (const word of q.split(/\s+/)) {
    const why = matchWord(word, name, meta);
    if (why === undefined) return { matched: false, reason: null };
    if (why !== null && !reasons.includes(why)) reasons.push(why);
  }
  return { matched: true, reason: reasons.length > 0 ? reasons.join(" · ") : null };
}
