import { describe, expect, it } from "vitest";
import type { Ownership } from "../../src/domain/completionist.ts";
import {
  addPreset,
  isPresetActive,
  modulePresets,
  movePreset,
  parsePresetSettings,
  removePreset,
  renamePreset,
  togglePin,
} from "../../src/domain/filterPresets.ts";
import {
  availableRanks,
  categoryCounts,
  DEFAULT_INVENTORY_FILTERS,
  ducatsPerPlat,
  DEFAULT_SELL_FROM,
  sellFromFor,
  sellFromSetting,
  inventoryPresetCodec,
  formatAge,
  lastChangedMap,
  recentDelta,
  recentSince,
  recentWindowFrom,
  toggleRank,
  visibleItems,
  type InventoryCatalogItem,
  type InventoryContext,
  type InventoryFilters,
} from "../../src/domain/inventory.ts";
import { DEFAULT_RELIC_FILTERS, relicPresetCodec } from "../../src/domain/relics.ts";

const items: InventoryCatalogItem[] = [
  { unique_name: "/a", name: "Ash Prime Systems", category: "Parts", vaulted: true, ducats: 100 },
  { unique_name: "/b", name: "Braton", category: "Primary" },
  { unique_name: "/c", name: "Ferrite", category: "Resources" },
  { unique_name: "/m", name: "Serration", category: "Mods" },
  { unique_name: "/g", name: "Blueprint", category: "Blueprints" },
];
const own = (o: Partial<Ownership> = {}): Ownership => ({ quantities: { "/a": 2, "/c": 900 }, mastery: { "/b": 30 }, subsumed: new Set(), ...o });
const ctx = (o: Partial<InventoryContext> = {}): InventoryContext => ({
  items,
  own: own(),
  prices: new Map([["ash prime systems", 20]]),
  lastChanged: { "/c": 1000 },
  mods: { "/m": { total: 3, by_rank: { "0": 1, "10": 2 } } },
  ...o,
});
const f = (o: Partial<InventoryFilters>): InventoryFilters => ({ ...DEFAULT_INVENTORY_FILTERS, ...o });
const names = (o: Partial<InventoryFilters>, c = ctx()) => visibleItems(f(o), c).rows.map((r) => r.item.name);

describe("visibleItems", () => {
  it("skips the generic Blueprint and lists owned items first by quantity", () => {
    expect(names({})).toEqual(["Ferrite", "Ash Prime Systems", "Braton", "Serration"]);
  });
  it("filters by category, search, owned, recent, vault and tradeable", () => {
    expect(names({ category: "Primary" })).toEqual(["Braton"]);
    expect(names({ search: "fer, bra" })).toEqual(["Ferrite", "Braton"]);
    expect(names({ filterOwned: true })).toEqual(["Ferrite", "Ash Prime Systems"]);
    expect(names({ filterRecent: true })).toEqual(["Ferrite"]);
    expect(names({ filterVaulted: true })).toEqual(["Ash Prime Systems"]);
    expect(names({ filterTradeable: true })).toEqual(["Ash Prime Systems", "Serration"]);
  });
  it("filters mods by scanned rank", () => {
    expect(names({ category: "Mods", filterRank: [10] })).toEqual(["Serration"]);
    expect(names({ category: "Mods", filterRank: [5] })).toEqual([]);
    expect(names({ category: "Mods", filterRank: [5, 10] })).toEqual(["Serration"]);
    expect(toggleRank([10, "unranked"], 3)).toEqual(["unranked", 3, 10]);
    expect(toggleRank([3, 10], 3)).toEqual([10]);
    expect(availableRanks(ctx().mods)).toEqual([10]);
  });
  it("price sorts hide unpriced items and fall back while prices load", () => {
    expect(names({ sortMode: "plat-desc" })).toEqual(["Ash Prime Systems"]);
    expect(names({ sortMode: "plat-desc" }, ctx({ prices: null }))).toEqual(["Ferrite", "Ash Prime Systems", "Braton", "Serration"]);
  });
  it("counts subsumed warframes as zero", () => {
    expect(visibleItems(f({}), ctx({ own: own({ subsumed: new Set(["/a"]) }) })).rows.find((r) => r.item.unique_name === "/a")?.qty).toBe(0);
  });
  it("counts per category", () => {
    expect(categoryCounts(items, own())).toMatchObject({ owned: { all: 2, Parts: 1, Resources: 1 }, total: { all: 5, Mods: 1 } });
  });
});

describe("recentDelta", () => {
  it("returns the net change since the start of the window", () => {
    const changes = [
      { unique_name: "/c", item_name: "Ferrite", delta: 50, timestamp: 1000 },
      { unique_name: "/c", item_name: "Ferrite", delta: -5, timestamp: 400 },
    ];
    expect(recentDelta(changes, "/c", 900, 1100)).toEqual({ delta: 50, minutesAgo: 1 });
    expect(recentDelta(changes, "/c", 0, 1100)).toEqual({ delta: 45, minutesAgo: 1 });
    expect(recentDelta(changes, "/c", 1001, 1100)).toBeNull();
  });

  it("uses whole-item changes when there are any, and per-rank changes otherwise", () => {
    const changes = [
      { unique_name: "/m", item_name: "Serration", delta: 1, timestamp: 1000, rank: 10 },
      { unique_name: "/m", item_name: "Serration", delta: 2, timestamp: 1000 },
    ];
    expect(recentDelta(changes, "/m", 0, 1000)?.delta).toBe(2);
    expect(recentDelta(changes.slice(0, 1), "/m", 0, 1000)?.delta).toBe(1);
  });
});

describe("recent window", () => {
  it("starts at app start, a fixed time ago, or the beginning of the log", () => {
    expect(recentSince("session", 100_000, 90_000)).toBe(90_000);
    expect(recentSince("hour", 100_000, 90_000)).toBe(96_400);
    expect(recentSince("day", 100_000, 90_000)).toBe(13_600);
    expect(recentSince("week", 700_000, 90_000)).toBe(95_200);
    expect(recentSince("all", 100_000, 90_000)).toBe(0);
  });

  it("falls back to since HexDesk started for a missing or unknown setting", () => {
    expect(recentWindowFrom(undefined)).toBe("session");
    expect(recentWindowFrom("month")).toBe("session");
    expect(recentWindowFrom("week")).toBe("week");
  });

  it("reads the sell-from price per ducat value, with defaults for what is missing", () => {
    expect(sellFromSetting(undefined)).toEqual(DEFAULT_SELL_FROM);
    expect(sellFromSetting({ "15": 4, "45": "abc", "100": 2000, "65": 0 })).toEqual({ 15: 4, 25: 3, 45: 5, 65: 1, 100: 999 });
    // Values between the tiers use the nearest one.
    expect([15, 20, 50, 90].map((d) => sellFromFor(d, DEFAULT_SELL_FROM))).toEqual([2, 2, 5, 10]);
    expect(ducatsPerPlat(45, 4)).toBe(11.25);
    expect([ducatsPerPlat(45, null), ducatsPerPlat(null, 4), ducatsPerPlat(45, 0)]).toEqual([null, null, null]);
  });

  it("formats a badge age in minutes, hours or days", () => {
    expect([0, 12, 60, 1439, 1440, 4000].map(formatAge)).toEqual(["now", "12m", "1h", "23h", "1d", "2d"]);
  });
});

describe("lastChangedMap", () => {
  it("only counts changes since the given time, so older history is not recent", () => {
    const changes = [
      { unique_name: "/c", item_name: "Ferrite", delta: 50, timestamp: 2000 },
      { unique_name: "/c", item_name: "Ferrite", delta: 5, timestamp: 1500 },
      { unique_name: "/b", item_name: "Braton", delta: 1, timestamp: 900 },
    ];
    expect(lastChangedMap(changes, 1000)).toEqual({ "/c": 2000 });
    expect(lastChangedMap(changes, 2001)).toEqual({});
  });
});

describe("filter presets", () => {
  const stored = {
    presets: [
      { id: "i1", name: "Owned", module: "inventory", createdAt: 1, pinned: true, filters: { ...DEFAULT_INVENTORY_FILTERS, filterOwned: true } },
      {
        id: "i2",
        name: "Legacy plat",
        module: "inventory",
        createdAt: 2,
        filters: { ...DEFAULT_INVENTORY_FILTERS, sortMode: "recent", filterPlat: true },
      },
      { id: "f1", name: "Foundry thing", module: "foundry", createdAt: 3, filters: { anything: true } },
      {
        id: "r1",
        name: "Lith",
        module: "relics",
        createdAt: 4,
        filters: { search: "", tiers: ["lith"], ownership: [], vault: [], completion: [], sortMode: "count", ignoreFormaKuva: false },
      },
      { id: "bad", name: "", module: "inventory", createdAt: 5, filters: {} },
    ],
    restorePreviousFiltersOnPresetClick: true,
  };
  const settings = parsePresetSettings(stored);

  it("keeps presets of other modules and drops invalid ones", () => {
    expect(settings.presets.map((p) => p.id)).toEqual(["i1", "i2", "f1", "r1"]);
    expect(settings.restorePreviousFiltersOnPresetClick).toBe(true);
  });

  it("decodes per module, including legacy fields", () => {
    const inv = modulePresets(settings, inventoryPresetCodec);
    expect(inv.map((p) => p.id)).toEqual(["i1", "i2"]);
    expect(inv[1]?.decoded.sortMode).toBe("plat-desc");
    expect(inv[0]?.decoded.filterRank).toEqual([]);
    const base = { ...DEFAULT_INVENTORY_FILTERS, filterRank: undefined };
    expect(inventoryPresetCodec.decode({ ...base, filterRank: 5 })?.filterRank).toEqual([5]);
    expect(inventoryPresetCodec.decode({ ...base, filterRank: [10, "unranked", 10] })?.filterRank).toEqual(["unranked", 10]);
    expect(modulePresets(settings, relicPresetCodec)[0]?.decoded.eras).toEqual(["lith"]);
  });

  it("detects the active preset", () => {
    const [owned] = modulePresets(settings, inventoryPresetCodec);
    if (!owned) throw new Error("fixture");
    expect(isPresetActive(owned, { ...DEFAULT_INVENTORY_FILTERS, filterOwned: true }, inventoryPresetCodec)).toBe(true);
    expect(isPresetActive(owned, DEFAULT_INVENTORY_FILTERS, inventoryPresetCodec)).toBe(false);
  });

  it("adds, renames, pins, moves and removes without touching other modules", () => {
    let s = addPreset(settings, relicPresetCodec, " Axi ", { ...DEFAULT_RELIC_FILTERS, eras: ["axi"] }, 99);
    const added = s.presets.at(-1);
    expect(added).toMatchObject({ name: "Axi", module: "relics", filters: { tiers: ["axi"], sortMode: "count" } });
    s = renamePreset(s, "r1", "Lith only");
    s = togglePin(s, "i2");
    s = movePreset(s, "relics-99", -1);
    expect(s.presets.filter((p) => p.module === "relics").map((p) => p.id)).toEqual(["relics-99", "r1"]);
    s = removePreset(s, "r1");
    expect(s.presets.map((p) => p.id)).toEqual(["i1", "i2", "f1", "relics-99"]);
    expect(s.presets.find((p) => p.id === "i2")?.pinned).toBe(true);
    expect(s.presets.find((p) => p.id === "f1")).toEqual(settings.presets[2]);
  });
});
