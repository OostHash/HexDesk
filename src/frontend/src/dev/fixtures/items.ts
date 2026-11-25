import type { CardMeta, ItemDetails, ModDetails, RankStats } from "../../domain/items";
import type { Fixture } from "./scenario";

/**
 * Card facts for the mods and arcanes of the inventory and market fixtures,
 * and full details for Serration (a mod) and Arcane Energize (an arcane).
 */
const mod = (compat: string, polarity: string, rarity: string, maxRank: number, typeName: string): CardMeta => ({
  rarity,
  polarity,
  compat,
  type_name: typeName,
  max_rank: maxRank,
  augment: false,
  exilus: false,
  utility: false,
  damage_types: [],
  effect: [],
});

const ARCANE = { augment: false, exilus: false, utility: false, damage_types: [], effect: [] };

const META: Record<string, CardMeta> = {
  "/Mods/Serration": mod("Rifle", "madurai", "Uncommon", 10, "Primary Mod"),
  "/Mods/Vitality": mod("Warframe", "vazarin", "Common", 10, "Warframe Mod"),
  "/Mods/BlindRage": mod("Warframe", "madurai", "Rare", 10, "Warframe Mod"),
  "/Mods/PrimedContinuity": mod("Warframe", "madurai", "Legendary", 10, "Warframe Mod"),
  "/Arcanes/Energize": { rarity: "Legendary", polarity: null, compat: null, type_name: "Warframe Arcane", max_rank: 5, ...ARCANE },
  "/Arcanes/Grace": { rarity: "Legendary", polarity: null, compat: null, type_name: "Warframe Arcane", max_rank: 5, ...ARCANE },
};

const perRank = (maxRank: number, text: (rank: number) => string[]): RankStats[] =>
  Array.from({ length: maxRank + 1 }, (_, rank) => ({ lines: text(rank), text_rank: rank }));

const SERRATION: ModDetails = {
  kind: "mod",
  unique_name: "/Mods/Serration",
  name: "Serration",
  type_name: "Primary Mod",
  rarity: "Uncommon",
  polarity: "madurai",
  compat: "Rifle",
  max_rank: 10,
  drain_by_rank: Array.from({ length: 11 }, (_, rank) => 4 + rank),
  stats_by_rank: perRank(10, (rank) => [`+${String(15 * (rank + 1))}% Damage`]),
  augment: false,
  exilus: false,
  utility: false,
  damage_types: [],
  tradable: true,
  drops: [
    { location: "Ceres/Hapke (Spy), Rotation C", variant: null, chance: 8.6, rarity: "Rare" },
    { location: "Earth/Cambria (Spy), Rotation C", variant: null, chance: 8.6, rarity: "Rare" },
    { location: "Kuva Scorpion", variant: null, chance: 0.22, rarity: "Rare" },
    { location: "Electric Crawler", variant: null, chance: 0.17, rarity: "Rare" },
    { location: "Scaldra Dedicant", variant: "Spectral Serration", chance: 0.1, rarity: "Rare" },
    { location: "Scaldra Eradicator", variant: "Spectral Serration", chance: 0.09, rarity: "Rare" },
  ],
  wiki_url: "https://wiki.warframe.com/w/Serration",
};

const ENERGIZE: ItemDetails = {
  kind: "arcane",
  unique_name: "/Arcanes/Energize",
  name: "Arcane Energize",
  type_name: "Warframe Arcane",
  rarity: "Legendary",
  max_rank: 5,
  stats_by_rank: perRank(5, (rank) => [
    "On Energy Pickup:",
    `60% chance to replenish ${String(25 * (rank + 1))} Energy to self and allies within 15m`,
    "15s cooldown",
    ...(rank >= 3 ? ["+1 Arcane Revive"] : []),
  ]),
  damage_types: [],
  tradable: true,
  drops: [
    { location: "Eidolon Hydrolyst (Capture)", variant: null, chance: 5, rarity: "Rare" },
    { location: "Veil Proxima/Erato (Skirmish), Rotation C", variant: null, chance: 1.41, rarity: "Rare" },
  ],
  wiki_url: "https://wiki.warframe.com/w/Arcane_Energize",
};

const DETAILS: Record<string, ItemDetails> = { [SERRATION.unique_name]: SERRATION, [ENERGIZE.unique_name]: ENERGIZE };

export const cardMeta: Fixture<Record<string, CardMeta>> = { default: () => META, empty: () => ({}) };

export const itemDetails: Fixture<ItemDetails | null, { uniqueName: string }> = {
  default: ({ uniqueName }) => DETAILS[uniqueName] ?? null,
  empty: () => null,
};
