import type { WfmItem, WfmItemInfo, WfmItemOrders, WfmStatPoint } from "../../domain/market";
import type { CatalogItem } from "../../domain/relics";
import type { Fixture } from "./scenario";

/**
 * Market on top of the relic catalogue's ten primes (five parts each):
 * Nova Prime complete with a duplicate Barrel, Paris Prime built, set
 * slugs with prices, a few mods and arcanes, and generated order books.
 */
const PRIMES = ["Ash", "Braton", "Burston", "Ember", "Frost", "Galatine", "Loki", "Mag", "Nova", "Paris"] as const;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

export const MARKET_ITEMS: CatalogItem[] = [
  { unique_name: "/Mods/BlindRage", name: "Blind Rage", category: "Mods" },
  { unique_name: "/Mods/PrimedContinuity", name: "Primed Continuity", category: "Mods" },
  { unique_name: "/Arcanes/Grace", name: "Arcane Grace", category: "Arcanes" },
  { unique_name: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", name: "Rifle Riven Mod", category: "Mods" },
  { unique_name: "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod", name: "Rifle Riven Mod", category: "Mods" },
  { unique_name: "/Lotus/Upgrades/Mods/Randomized/RawShotgunRandomMod", name: "Shotgun Riven Mod", category: "Mods" },
];

export const MARKET_QUANTITIES: Record<string, number> = {
  "/Prime/Nova/Blueprint": 1,
  "/Prime/Nova/Barrel": 2,
  "/Prime/Nova/Receiver": 1,
  "/Prime/Nova/Stock": 1,
  "/Prime/Nova/Systems Blueprint": 1,
  "/Prime/Paris": 1,
  "/Mods/BlindRage": 2,
};

const MOD_NAMES = ["Serration", "Vitality", "Arcane Energize", ...MARKET_ITEMS.map((i) => i.name)];

export const MARKET_WFM_ITEMS: WfmItem[] = [
  ...PRIMES.map((p) => ({ id: slug(`${p} Prime Set`), item_name: `${p} Prime Set`, url_name: slug(`${p} Prime Set`) })),
  ...MOD_NAMES.map((n) => ({ id: slug(n), item_name: n, url_name: slug(n) })),
];

export const MARKET_PRICES: Record<string, number | null> = {
  ...Object.fromEntries(PRIMES.map((p, i) => [slug(`${p} Prime Set`), i === 3 ? null : 40 + ((i * 37) % 160)])),
  serration: 12,
  vitality: 8,
  arcane_energize: 45,
  blind_rage: 18,
  primed_continuity: 55,
};

const hash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h;
};
const isMod = (urlName: string) => MOD_NAMES.some((n) => slug(n) === urlName);

export const itemInfo: Fixture<WfmItemInfo | null, { urlName: string }> = {
  default: ({ urlName }) => ({ id: urlName, ...(isMod(urlName) ? { modMaxRank: urlName.startsWith("arcane") ? 5 : 10 } : {}) }),
};

export const itemStatistics: Fixture<WfmStatPoint[], { urlName: string }> = {
  default: ({ urlName }) => {
    const base = 10 + (hash(urlName) % 60);
    return Array.from({ length: 30 }, (_, d) => ({
      datetime: new Date(Date.UTC(2026, 9, 14 + d)).toISOString(),
      median: base + ((d * 7 + hash(urlName)) % 9) - 4,
      volume: 20 + ((d * 13) % 40),
    }));
  },
  empty: () => [],
};

const STATUSES = ["ingame", "online", "offline"] as const;
const SELLERS = ["Ordis_Fan", "VoidTrader", "LotusEater", "KuvaKing", "TennoMart"];
const BUYERS = ["DucatHunter", "PrimeTimer", "RelicRunner", "SetCollector"];

export const itemOrders: Fixture<WfmItemOrders, { urlName: string; modRank: number | null }> = {
  default: ({ urlName, modRank }) => {
    const base = 10 + (hash(urlName) % 60) + (modRank ?? 0) * 3;
    const rank = modRank === null ? {} : { mod_rank: modRank };
    return {
      sell: SELLERS.map((name, i) => ({
        platinum: base + i * 2,
        quantity: 1 + (i % 3),
        user: { ingameName: name, reputation: 10 * i, status: STATUSES[i % 3] ?? "offline" },
        ...rank,
      })),
      buy: BUYERS.map((name, i) => ({
        platinum: base - 3 - i * 2,
        quantity: 1,
        user: { ingameName: name, reputation: 5 * i, status: STATUSES[(i + 1) % 3] ?? "offline" },
        ...rank,
      })),
    };
  },
  empty: () => ({ sell: [], buy: [] }),
};

export const createOrder: Fixture<unknown, { itemId: string; platinum: number }> = {
  alwaysDefault: true,
  default: ({ itemId, platinum }) => ({ id: `order-${itemId}`, platinum }),
};

/** Fire-and-forget commands (queue, token refresh). */
export const noResult = <A>(): Fixture<null, A> => ({ alwaysDefault: true, default: () => null });
