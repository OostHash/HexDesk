import { describe, expect, it } from "vitest";
import type { Ownership } from "../../src/domain/completionist.ts";
import {
  applyReadyFilter,
  componentStatus,
  DEFAULT_FOUNDRY_FILTERS,
  defaultExpanded,
  filterItems,
  foundryPresetCodec,
  foundryWikiUrl,
  isBuilding,
  isMastered,
  isReady,
  mergeComponents,
  ownedRelicsFor,
  pageSizeFrom,
  parseShard,
  patchFilters,
  recipeTree,
  shoppingList,
  type FoundryItem,
  type RecipeComponent,
} from "../../src/domain/foundry.ts";

const part = (unique_name: string, count = 1, components: RecipeComponent[] = [], result_count = 1): RecipeComponent => ({
  unique_name,
  name: unique_name.slice(1),
  count,
  result_count,
  components,
});

const own = (quantities: Record<string, number>, mastery: Record<string, number> = {}, subsumed: string[] = []): Ownership => ({
  quantities,
  mastery,
  subsumed: new Set(subsumed),
});

const items: FoundryItem[] = [
  { unique_name: "/ash", name: "Ash Prime", category: "Warframes", vaulted: true, masterable: true },
  { unique_name: "/braton", name: "Braton", category: "Primary", masterable: true },
  { unique_name: "/forma", name: "Forma", category: "Miscellaneous", masterable: false },
  { unique_name: "/bramma", name: "Kuva Bramma", category: "Primary", masterable: true, max_level_cap: 40 },
  { unique_name: "/rhino", name: "Rhino", category: "Warframes", masterable: true },
];
const item = (i: number): FoundryItem => {
  const found = items[i];
  if (!found) throw new Error(`no item ${String(i)}`);
  return found;
};
const f = (patch: Partial<typeof DEFAULT_FOUNDRY_FILTERS>) => ({ ...DEFAULT_FOUNDRY_FILTERS, ...patch });
const names = (list: FoundryItem[]) => list.map((i) => i.name);

describe("foundry filters", () => {
  const o = own({ "/braton": 1, "/rhino": 1 }, { "/braton": 30, "/bramma": 30 }, ["/rhino"]);

  it("filters by category and comma-separated search", () => {
    expect(names(filterItems(items, f({ activeCat: "Primary" }), o))).toEqual(["Braton", "Kuva Bramma"]);
    expect(names(filterItems(items, f({ search: "ash, forma" }), o))).toEqual(["Ash Prime", "Forma"]);
  });

  it("treats vault status as prime", () => {
    expect(names(filterItems(items, f({ filterPrime: true }), o))).toEqual(["Ash Prime"]);
    expect(names(filterItems(items, f({ filterNonPrime: true }), o))).not.toContain("Ash Prime");
  });

  it("counts subsumed warframes as not owned", () => {
    expect(names(filterItems(items, f({ filterOwned: true }), o))).toEqual(["Braton"]);
  });

  it("can count Forma and Kuva as owned", () => {
    expect(names(filterItems(items, f({ filterOwned: true, ignoreFormaKuva: true }), o))).toEqual(["Braton", "Forma"]);
    expect(names(filterItems(items, f({ filterUnowned: true, ignoreFormaKuva: true }), o))).not.toContain("Forma");
  });

  it("uses the level cap for mastery and skips non-masterable items", () => {
    expect(names(filterItems(items, f({ filterMastered: true }), o))).toEqual(["Braton"]);
    expect(names(filterItems(items, f({ filterUnmastered: true }), o))).toEqual(["Ash Prime", "Kuva Bramma", "Rhino"]);
    expect(names(filterItems(items, f({ filterLvlCap: true }), o))).toEqual(["Kuva Bramma"]);
  });

  it("keeps the filter side effects", () => {
    expect(patchFilters(f({ activeCat: "Melee" }), { search: "x" }).activeCat).toBe("All");
    expect(patchFilters(f({ search: "x" }), { activeCat: "Melee" }).search).toBe("");
    expect(patchFilters(f({ filterUnmastered: true }), { filterMastered: true }).filterUnmastered).toBe(false);
    expect(patchFilters(f({ activeCat: "Melee" }), { filterLvlCap: true }).activeCat).toBe("All");
  });

  it("reads the page size setting", () => {
    expect(pageSizeFrom(60)).toBe(60);
    expect(pageSizeFrom("60")).toBe(30);
    expect(pageSizeFrom(undefined)).toBe(30);
  });
});

describe("recipes", () => {
  const recipe = [part("/bp"), part("/barrel"), part("/barrel"), part("/stock", 2, [part("/stockbp"), part("/ferrite", 100)])];

  it("merges duplicate components", () => {
    expect(mergeComponents(recipe).find((c) => c.unique_name === "/barrel")?.count).toBe(2);
  });

  it("is ready only when every part is there and the item is not owned", () => {
    const braton = item(1);
    expect(isReady(braton, recipe, own({ "/bp": 1, "/barrel": 2, "/stock": 2 }))).toBe(true);
    expect(isReady(braton, recipe, own({ "/bp": 1, "/barrel": 1, "/stock": 2 }))).toBe(false);
    expect(isReady(braton, recipe, own({ "/braton": 1, "/bp": 1, "/barrel": 2, "/stock": 2 }))).toBe(false);
    expect(isReady(braton, [], own({}))).toBe(false);
  });

  it("applies the Ready filter with the given recipes", () => {
    const recipes = new Map([["/braton", recipe]]);
    const o = own({ "/bp": 1, "/barrel": 2, "/stock": 2 });
    expect(names(applyReadyFilter(items, f({ filterReady: true }), recipes, o))).toEqual(["Braton"]);
  });

  it("knows part, blueprint and missing components", () => {
    const stock = mergeComponents(recipe)[2];
    if (!stock) throw new Error("no stock");
    expect(componentStatus(stock, own({ "/stock": 2 }))).toBe("part");
    expect(componentStatus(stock, own({ "/stockbp": 1 }))).toBe("blueprint");
    expect(componentStatus(stock, own({}))).toBe("none");
  });

  it("builds a tree with all four statuses and opens short nodes", () => {
    const tree = recipeTree(recipe, own({ "/bp": 1, "/barrel": 1, "/stockbp": 1, "/ferrite": 100 }));
    expect(tree.map((n) => n.status)).toEqual(["owned", "partial", "craftable"]);
    expect(recipeTree([part("/x", 1, [part("/y")])], own({}))[0]?.status).toBe("missing");
    expect(defaultExpanded(tree)).toEqual(["//stock"]);
  });

  it("lists everything short across the tree, with result counts", () => {
    const deep = [part("/plate", 3, [part("/alloy", 10)], 2)];
    expect(shoppingList(deep, own({ "/alloy": 5 }))).toEqual([
      { unique_name: "/alloy", name: "alloy", needed: 20, owned: 5 },
      { unique_name: "/plate", name: "plate", needed: 3, owned: 0 },
    ]);
  });

  it("matches a building job on the item or its blueprint", () => {
    const braton = item(1);
    expect(isBuilding(braton, recipe, [{ unique_name: "/bp" }])).toBe(true);
    expect(isBuilding(braton, undefined, [{ unique_name: "/braton" }])).toBe(true);
    expect(isBuilding(braton, recipe, [{ unique_name: "/other" }])).toBe(false);
  });

  it("names owned relics of any refinement", () => {
    const drops = { "/bp": ["/Relics/NeoA1Bronze", "/Relics/AxiB2Bronze"] };
    const relicNames = new Map([["/Relics/NeoA1Gold", "Neo A1 Flawless"]]);
    expect(ownedRelicsFor("/bp", drops, relicNames, own({ "/Relics/NeoA1Gold": 1 }))).toEqual(["Neo A1 Flawless"]);
    expect(ownedRelicsFor("/bp", drops, relicNames, own({}))).toEqual([]);
  });
});

describe("mastery, shards, wiki and presets", () => {
  it("defaults the cap to 30 for levelable items", () => {
    expect(isMastered(item(1), own({}, { "/braton": 30 }))).toBe(true);
    expect(isMastered(item(3), own({}, { "/bramma": 30 }))).toBe(false);
    expect(isMastered(item(2), own({}, { "/forma": 30 }))).toBe(false);
  });

  it("decodes shard colours from names and numbers", () => {
    expect(parseShard({ upgrade_type: "/X/ArchonCrystalUpgradeWarframeAbilityStrength", color: "ACC_RED" })).toEqual({
      type: "Crimson",
      tauforged: false,
      boost: "Ability Strength",
    });
    expect(parseShard({ upgrade_type: "/X/Y", color: "ACC_YELLOW_MYTHIC" })).toMatchObject({ type: "Amber", tauforged: true });
    expect(parseShard({ upgrade_type: "/X/Y", color: "6" })).toMatchObject({ type: "Azure", tauforged: true });
  });

  it("links the wiki page without the Blueprint suffix", () => {
    expect(foundryWikiUrl("Braton Prime Blueprint")).toBe("https://wiki.warframe.com/w/Braton_Prime");
  });

  it("stores presets without the category and keeps the open one", () => {
    const codec = foundryPresetCodec("Melee");
    const stored = codec.encode(f({ activeCat: "Primary", filterPrime: true }));
    expect(stored).not.toHaveProperty("activeCat");
    expect(codec.decode(stored)).toEqual(f({ activeCat: "Melee", filterPrime: true }));
    expect(codec.decode({ search: "" })).toBeNull();
  });
});
