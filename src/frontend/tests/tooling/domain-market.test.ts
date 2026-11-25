import { describe, expect, it } from "vitest";
import type { Ownership } from "../../src/domain/completionist.ts";
import {
  buildSets,
  buildWfmLookup,
  DEFAULT_SET_FILTERS,
  DEFAULT_MOD_FILTERS,
  ducatTotals,
  median48h,
  modQty,
  prefillPrice,
  queueOrder,
  rankCopies,
  requiredCounts,
  setGroup,
  setGroupCounts,
  setName,
  setParts,
  sparkline,
  visibleMods,
  modGroupCounts,
  activeModFilterCount,
  visibleSets,
  whisper,
  type SetFilters,
  type SetContext,
} from "../../src/domain/market.ts";
import type { CatalogItem } from "../../src/domain/relics.ts";

const own = (quantities: Record<string, number> = {}): Ownership => ({ quantities, mastery: {}, subsumed: new Set() });

const catalog: CatalogItem[] = [
  { unique_name: "/ash", name: "Ash Prime", category: "Warframes", vaulted: true },
  { unique_name: "/ash/bp", name: "Ash Prime Blueprint", category: "Misc", ducats: 45 },
  { unique_name: "/ash/chassis", name: "Ash Prime Chassis", category: "Misc", ducats: 15 },
  { unique_name: "/ash/chassisbp", name: "Ash Prime Chassis Blueprint", category: "Misc" },
  { unique_name: "/ash/systemsbp", name: "Ash Prime Systems Blueprint", category: "Misc", ducats: 100 },
  { unique_name: "/aks", name: "Aksomati Prime", category: "Secondary", vaulted: false },
  { unique_name: "/aks/barrel", name: "Aksomati Prime Barrel", category: "Misc", ducats: 45 },
  { unique_name: "/aks/bp", name: "Aksomati Prime Blueprint", category: "Misc", ducats: 15 },
  { unique_name: "/talons", name: "Garuda Prime Talons Blueprint", category: "Misc" },
  { unique_name: "/serration", name: "Serration", category: "Mods" },
  { unique_name: "/grace", name: "Arcane Grace", category: "Arcanes" },
];

describe("prime sets", () => {
  const sets = buildSets(catalog);
  const ash = sets.find((s) => s.name === "Ash Prime");
  const ashSet = () => {
    if (!ash) throw new Error("no Ash Prime set");
    return ash;
  };

  it("groups parts by set and finds the parent", () => {
    expect(setName("Ash Prime Systems Blueprint")).toBe("Ash Prime");
    expect(sets.map((s) => s.name).sort()).toEqual(["Aksomati Prime", "Ash Prime"]);
    expect(ash?.parent?.unique_name).toBe("/ash");
  });

  it("prefers blueprints over built parts and inherits their ducats", () => {
    const names = ash?.parts.map((p) => p.name).sort();
    expect(names).toEqual(["Ash Prime Blueprint", "Ash Prime Chassis Blueprint", "Ash Prime Systems Blueprint"]);
    expect(ash?.parts.find((p) => p.name === "Ash Prime Chassis Blueprint")?.ducats).toBe(15);
  });

  it("drops sets without tradeable parts (exalted weapons)", () => {
    expect(sets.some((s) => s.name.startsWith("Garuda"))).toBe(false);
  });

  const recipes = [[{ unique_name: "/aks/barrel", name: "Barrel", count: 2, result_count: 1, components: [] }]];
  const lookup = buildWfmLookup([
    { id: "1", item_name: "Ash Prime Set", url_name: "ash_prime_set" },
    { id: "2", item_name: "Aksomati Prime Set", url_name: "aksomati_prime_set" },
    { id: "3", item_name: "Ash Prime Chassis", url_name: "ash_prime_chassis" },
  ]);
  const ctx = (quantities: Record<string, number>): SetContext => ({
    own: own(quantities),
    required: requiredCounts(recipes),
    lookup,
    prices: new Map([
      ["ash_prime_set", { sell_median: 80 }],
      ["aksomati_prime_set", { sell_median: 120 }],
    ]),
  });
  const f = (patch: Partial<SetFilters>): SetFilters => ({ ...DEFAULT_SET_FILTERS, ...patch });
  const names = (rows: ReturnType<typeof visibleSets>) => rows.map((r) => r.set.name);

  it("maps Blueprint names to slugs without the suffix", () => {
    expect(lookup.get("ash_prime_chassis_blueprint")).toBe("ash_prime_chassis");
    expect(setParts(ashSet(), ctx({})).find((p) => p.label === "Chassis Blueprint")?.slug).toBe("ash_prime_chassis");
  });

  it("counts duplicates against the recipe (two barrels are not a dupe)", () => {
    const c = ctx({ "/aks/barrel": 2, "/ash/bp": 2 });
    expect(names(visibleSets(sets, f({ dupes: true }), c))).toEqual(["Ash Prime"]);
    expect(ducatTotals(sets, c)).toEqual({ total: 2 * 45 + 2 * 45, dupes: 45 });
  });

  it("filters on the built item, parts, complete sets and vault status", () => {
    const c = ctx({ "/aks": 1, "/ash/bp": 1, "/ash/chassisbp": 1, "/ash/systemsbp": 1 });
    expect(names(visibleSets(sets, f({ built: ["owned"] }), c))).toEqual(["Aksomati Prime"]);
    expect(names(visibleSets(sets, f({ built: ["owned", "notowned"] }), c))).toHaveLength(2);
    expect(names(visibleSets(sets, f({ hasParts: true }), c))).toEqual(["Ash Prime"]);
    expect(names(visibleSets(sets, f({ complete: true }), c))).toEqual(["Ash Prime"]);
    expect(names(visibleSets(sets, f({ vault: ["vaulted"] }), c))).toEqual(["Ash Prime"]);
  });

  it("finds sets one part short of complete", () => {
    const c = ctx({ "/ash/bp": 1, "/ash/chassisbp": 1, "/aks/bp": 1 });
    expect(names(visibleSets(sets, f({ missingOne: true }), c))).toEqual(["Aksomati Prime", "Ash Prime"]);
    expect(names(visibleSets(sets, f({ missingOne: true }), ctx({ "/ash/bp": 1 })))).toEqual([]);
  });

  it("groups sets by the built item's category, else Other", () => {
    expect(setGroup(ashSet())).toBe("Warframes");
    expect(setGroup({ name: "Kavasa Prime", parent: null, parts: [] })).toBe("other");
    expect(names(visibleSets(sets, f({ group: "Secondary" }), ctx({})))).toEqual(["Aksomati Prime"]);
    const counts = setGroupCounts(sets, own({ "/ash/bp": 1 }));
    expect(counts.total).toEqual({ all: 2, Warframes: 1, Secondary: 1 });
    expect(counts.withParts).toEqual({ all: 1, Warframes: 1 });
  });

  it("sorts by best value, set price, ducats and name", () => {
    const c = ctx({ "/ash/systemsbp": 1 });
    expect(names(visibleSets(sets, f({ sort: "plat" }), c))).toEqual(["Aksomati Prime", "Ash Prime"]);
    expect(names(visibleSets(sets, f({ sort: "ducats" }), c))).toEqual(["Ash Prime", "Aksomati Prime"]);
    expect(names(visibleSets(sets, f({ sort: "za" }), c))).toEqual(["Ash Prime", "Aksomati Prime"]);
    const full = ctx({ "/aks/barrel": 2, "/aks/bp": 1 });
    expect(names(visibleSets(sets, f({ sort: "value" }), full))).toEqual(["Aksomati Prime", "Ash Prime"]);
  });

  it("compares one set's worth of parts with the set price", () => {
    const priced = (quantities: Record<string, number>): SetContext => ({
      ...ctx(quantities),
      prices: new Map([
        ["aksomati_prime_set", { sell_median: 120 }],
        ["aksomati_prime_barrel", { sell_median: 40 }],
        ["aksomati_prime_blueprint", { sell_median: 50 }],
      ]),
    });
    const value = (quantities: Record<string, number>) => visibleSets(sets, f({ group: "Secondary" }), priced(quantities))[0]?.value;
    // Three barrels: the recipe needs two, the third is a dupe and is left out.
    expect(value({ "/aks/barrel": 3, "/aks/bp": 1 })).toEqual({ set: 120, parts: 130, ducats: 2 * 45 + 15, best: "parts", top: 130 });
    expect(value({ "/aks/barrel": 2 })).toEqual({ set: 120, parts: 80, ducats: 90, best: null, top: 80 });
    // A part without a price makes the parts value unknown, not lower.
    const ash = visibleSets(sets, f({ group: "Warframes" }), priced({ "/ash/bp": 1, "/ash/chassisbp": 1, "/ash/systemsbp": 1 }))[0]?.value;
    expect(ash).toMatchObject({ parts: null, best: null });
  });

  it("queues owned sets first, set slug before parts", () => {
    const order = queueOrder(sets, { own: own({ "/aks/bp": 1 }), lookup });
    expect(order[0]).toBe("aksomati_prime_set");
    expect(order.indexOf("ash_prime_set")).toBeGreaterThan(order.indexOf("aksomati_prime_blueprint"));
  });
});

describe("mods", () => {
  const mods = { "/serration": { total: 3, by_rank: { "0": 1, "10": 2 } } };
  const ctx = {
    own: own({ "/serration": 1 }),
    mods,
    lookup: new Map([["arcane_grace", "arcane_grace"]]),
    prices: new Map([["arcane_grace", { sell_median: 30 }]]),
    meta: {
      "/serration": {
        rarity: "Uncommon",
        polarity: "madurai",
        compat: "Rifle",
        type_name: "Primary Mod",
        max_rank: 10,
        augment: false,
        exilus: false,
        utility: false,
        damage_types: [],
        effect: [],
      },
      "/grace": {
        rarity: "Legendary",
        polarity: null,
        compat: null,
        type_name: "Warframe Arcane",
        max_rank: 5,
        augment: false,
        exilus: false,
        utility: false,
        damage_types: [],
        effect: [],
      },
    },
  };

  it("counts scanner copies and lists ranks highest first", () => {
    expect(modQty(ctx.own, mods, "/serration")).toBe(3);
    expect(rankCopies(mods, "/serration")).toEqual([
      { rank: 10, count: 2 },
      { rank: 0, count: 1 },
    ]);
  });

  it("filters by navigator group and ownership and sorts by price", () => {
    const names = (patch: Partial<typeof DEFAULT_MOD_FILTERS>) => visibleMods(catalog, { ...DEFAULT_MOD_FILTERS, ...patch }, ctx).map((i) => i.name);
    expect(names({})).toEqual(["Serration", "Arcane Grace"]);
    expect(names({ group: "arcanes" })).toEqual(["Arcane Grace"]);
    expect(names({ group: "mod-primary" })).toEqual(["Serration"]);
    expect(names({ group: "mod-warframe" })).toEqual([]);
    expect(names({ owned: true })).toEqual(["Serration"]);
    expect(names({ incomplete: true })).toEqual([]);
    expect(names({ sort: "plat" })).toEqual(["Arcane Grace", "Serration"]);
  });

  it("filters by rarity, polarity, traits and owned rank", () => {
    const names = (patch: Partial<typeof DEFAULT_MOD_FILTERS>) => visibleMods(catalog, { ...DEFAULT_MOD_FILTERS, ...patch }, ctx).map((i) => i.name);
    expect(names({ rarity: ["Legendary"] })).toEqual(["Arcane Grace"]);
    expect(names({ polarity: ["madurai"] })).toEqual(["Serration"]);
    expect(names({ traits: ["augment"] })).toEqual([]);
    expect(names({ ranks: [10] })).toEqual(["Serration"]);
    expect(names({ ranks: [5] })).toEqual([]);
    expect(activeModFilterCount({ ...DEFAULT_MOD_FILTERS, rarity: ["Rare"], ranks: [10, "unranked"] })).toBe(3);
  });

  it("lists rivens in their own group and counts each navigator group", () => {
    const riven = { unique_name: "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod", name: "Rifle Riven Mod", category: "Mods" };
    const withRiven = [...catalog, riven];
    const names = (group: string) => visibleMods(withRiven, { ...DEFAULT_MOD_FILTERS, group }, ctx).map((i) => i.name);
    expect(names("mod-riven")).toEqual(["Rifle Riven Mod"]);
    expect(names("mod-primary")).toEqual(["Serration"]);
    const counts = modGroupCounts(withRiven, ctx);
    expect(counts.total).toEqual({ all: 3, mods: 2, "mod-primary": 1, "mod-riven": 1, arcanes: 1, "arcane-warframe": 1 });
    expect(counts.owned).toEqual({ all: 1, mods: 1, "mod-primary": 1 });
  });
});

describe("item window", () => {
  const stats = Array.from({ length: 30 }, (_, i) => ({ datetime: String(i), median: 10 + i, volume: 1 }));
  const order = { platinum: 25, quantity: 1, user: { ingameName: "Tenno", reputation: 1, status: "ingame" } };

  it("uses the second-to-last point as the 48h median and draws three weeks", () => {
    expect(median48h(stats)).toBe(38);
    const line = sparkline(stats);
    expect(line?.points.split(" ")).toHaveLength(21);
    expect(line).toMatchObject({ low: 19, high: 39, last: 39 });
    expect(sparkline(stats.slice(0, 1))).toBeNull();
  });

  it("writes the whisper from the other side", () => {
    expect(whisper(order, "sell", "Ash Prime Set")).toBe('/w Tenno Hi! I want to buy: "Ash Prime Set" for 25 platinum. (warframe.market)');
    expect(whisper(order, "buy", "X")).toContain("I want to sell");
  });

  it("prefills the best order, else the median, in whole platinum", () => {
    expect(prefillPrice("sell", { sell: [order], buy: [] }, 30)).toBe(25);
    expect(prefillPrice("buy", { sell: [order], buy: [] }, 30.6)).toBe(31);
  });
});
