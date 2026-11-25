import { describe, expect, it } from "vitest";
import type { Ownership } from "../../src/domain/completionist.ts";
import {
  buildCatalogIndex,
  buildPriceIndex,
  chanceToRarity,
  DEFAULT_RELIC_FILTERS,
  expectedValue,
  filterRelics,
  findRewardItem,
  parseDropData,
  plannerRows,
  refinementCounts,
  relicComplete,
  relicSources,
  rewardState,
  splitSearchTerms,
  type CatalogItem,
  type RelicContext,
} from "../../src/domain/relics.ts";

const catalog: CatalogItem[] = [
  { unique_name: "/r/lithA1i", name: "Lith A1 Intact", category: "Relics", vaulted: true },
  { unique_name: "/r/lithA1r", name: "Lith A1 Radiant", category: "Relics", vaulted: true },
  { unique_name: "/r/mesoB2i", name: "Meso B2 Intact", category: "Relics", vaulted: false },
  { unique_name: "/w/bp", name: "Burston Prime Barrel", category: "Misc", ducats: 45 },
  { unique_name: "/w/burston", name: "Burston Prime", category: "Primary", image_name: "burston.png" },
  { unique_name: "/w/stock", name: "Burston Prime Stock", category: "Misc", ducats: 15 },
  { unique_name: "/w/forma", name: "Forma Blueprint", category: "Misc" },
  { unique_name: "/w/ash", name: "Ash Prime Systems Blueprint", category: "Misc", ducats: 100 },
];
const index = buildCatalogIndex(catalog);
const own = (o: Partial<Ownership> = {}): Ownership => ({ quantities: {}, mastery: {}, subsumed: new Set(), ...o });

const raw = {
  relics: [
    {
      tier: "Lith",
      relicName: "A1",
      state: "Intact",
      rewards: [
        { itemName: "Burston Prime Barrel", chance: 2 },
        { itemName: "Forma Blueprint", chance: 25.33 },
        { itemName: "Burston Prime Stock", chance: 11 },
      ],
    },
    { tier: "Lith", relicName: "A1", state: "Radiant", rewards: [] },
    { tier: "Meso", relicName: "B2", state: "Intact", rewards: [{ itemName: "Ash Prime Systems Blueprint", chance: 11 }] },
  ],
};
const drops = parseDropData(raw);
const relic = (name: string) => {
  const found = drops.find((d) => d.fullName === name);
  if (!found) throw new Error(`fixture relic ${name} missing`);
  return found;
};
const lith = relic("Lith A1");

describe("drop data", () => {
  it("keeps Intact relics with rewards sorted Common → Rare", () => {
    expect(drops.map((d) => d.fullName)).toEqual(["Lith A1", "Meso B2"]);
    expect(lith.rewards.map((r) => r.rarity)).toEqual(["Common", "Uncommon", "Rare"]);
  });
  it("derives rarity from chance", () => {
    expect([chanceToRarity(25), chanceToRarity(11), chanceToRarity(2)]).toEqual(["Common", "Uncommon", "Rare"]);
  });
  it("is empty for junk", () => {
    expect(parseDropData(null)).toEqual([]);
  });
});

describe("ownership", () => {
  it("sums refinements", () => {
    const counts = refinementCounts(lith, index, own({ quantities: { "/r/lithA1i": 2, "/r/lithA1r": 1 } }));
    expect(counts).toMatchObject({ intact: 2, radiant: 1, total: 3 });
  });

  it("lists the relics that drop an item, owned and unvaulted first", () => {
    const withMeso = [...drops, { ...lith, tier: "Meso", relicName: "B2", fullName: "Meso B2" }];
    const sources = relicSources("burston prime barrel", withMeso, index, own({ quantities: { "/r/lithA1r": 1 } }));
    expect(sources.map((s) => [s.relic.fullName, s.rarity, s.owned.total, s.vaulted])).toEqual([
      ["Lith A1", "Rare", 1, true],
      ["Meso B2", "Rare", 0, false],
    ]);
    expect(relicSources("Burston Prime Barrel", withMeso, index, own()).map((s) => s.relic.fullName)).toEqual(["Meso B2", "Lith A1"]);
    expect(relicSources("Nothing", drops, index, own())).toEqual([]);
  });

  it("finds reward items with blueprint toggling and borrows the parent image", () => {
    expect(findRewardItem("Forma", index)?.unique_name).toBe("/w/forma");
    expect(findRewardItem("Burston Prime Barrel", index)?.image_name).toBe("burston.png");
  });

  it("owned means the item, complete means the parent prime is owned or mastered", () => {
    const barrel = lith.rewards.find((r) => r.itemName.includes("Barrel"));
    if (!barrel) throw new Error("fixture reward missing");
    expect(rewardState(barrel, index, own({ quantities: { "/w/bp": 1 } }), false)).toEqual({ owned: true, complete: false });
    expect(rewardState(barrel, index, own({ mastery: { "/w/burston": 30 } }), false)).toEqual({ owned: false, complete: true });
  });

  it("Ignore Forma/Kuva completes those rewards", () => {
    const o = own({ mastery: { "/w/burston": 30 } });
    expect(relicComplete(lith, index, o, false)).toBe(false);
    expect(relicComplete(lith, index, o, true)).toBe(true);
  });
});

describe("filters and sorting", () => {
  const ctx: RelicContext = {
    index,
    own: own({ quantities: { "/r/mesoB2i": 1 } }),
    prices: buildPriceIndex([{ item_name: "Burston Prime Barrel", url_name: "burston_prime_barrel" }], { burston_prime_barrel: 50 }),
  };

  it("searches relic and reward names, comma-separated OR", () => {
    expect(splitSearchTerms(" ash , barrel ")).toEqual(["ash", "barrel"]);
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, search: "ash" }, ctx).map((d) => d.fullName)).toEqual(["Meso B2"]);
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, search: "ash, barrel" }, ctx)).toHaveLength(2);
  });

  it("treats both options of a pair as no filter", () => {
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, vault: ["vaulted"] }, ctx).map((d) => d.fullName)).toEqual(["Lith A1"]);
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, vault: ["vaulted", "unvaulted"] }, ctx)).toHaveLength(2);
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, ownership: ["owned"] }, ctx).map((d) => d.fullName)).toEqual(["Meso B2"]);
  });

  it("sorts by owned count, ducats and (now working) platinum", () => {
    expect(filterRelics(drops, DEFAULT_RELIC_FILTERS, ctx)[0]?.fullName).toBe("Meso B2");
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, sort: "ducats" }, ctx)[0]?.fullName).toBe("Meso B2");
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, sort: "plat" }, ctx)[0]?.fullName).toBe("Lith A1");
    expect(filterRelics(drops, { ...DEFAULT_RELIC_FILTERS, sort: "za" }, ctx)[0]?.fullName).toBe("Meso B2");
  });
});

describe("planner", () => {
  // A real relic: 3 common, 2 uncommon, 1 rare, so each draw's chances sum to 1.
  const full =
    parseDropData({
      relics: [
        {
          tier: "Axi",
          relicName: "Z9",
          state: "Intact",
          rewards: [
            { itemName: "C1", chance: 25.33 },
            { itemName: "C2", chance: 25.33 },
            { itemName: "C3", chance: 25.33 },
            { itemName: "U1", chance: 11 },
            { itemName: "U2", chance: 11 },
            { itemName: "R1", chance: 2 },
          ],
        },
      ],
    })[0]?.rewards ?? [];
  const rareOnly = [0, 0, 0, 0, 0, 100];

  it("solo EV is Σ chance × value", () => {
    expect(expectedValue(full, "intact", rareOnly, 1)).toBeCloseTo(2, 5);
    expect(expectedValue(full, "radiant", rareOnly, 1)).toBeCloseTo(10, 5);
  });
  it("a squad picks the best of every draw", () => {
    expect(expectedValue(full, "intact", rareOnly, 2)).toBeCloseTo(100 * (1 - 0.98 ** 2), 1);
    expect(expectedValue(full, "intact", rareOnly, 4)).toBeCloseTo(100 * (1 - 0.98 ** 4), 1);
  });
  it("rows filter, value and pick the best refinement", () => {
    const ctx: RelicContext = { index, own: own(), prices: new Map() };
    const rows = plannerRows(drops, { metric: "ducat", squad: 1, eras: ["lith"], vault: "all", ownedOnly: false }, ctx);
    expect(rows.map((r) => r.drop.fullName)).toEqual(["Lith A1"]);
    expect(rows[0]?.best).toBe("radiant");
    expect(rows[0]?.gain).toBeGreaterThan(0);
  });
});
