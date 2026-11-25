import { describe, expect, it } from "vitest";
import { DEFAULT_MOD_FILTERS, type ModFilters } from "../../src/domain/market.ts";
import { ownRivenCards, rivenGroupCount, rivenRows, veiledCounts, visibleRivens, type RivenEntry } from "../../src/domain/rivenCards.ts";
import type { CatalogItem } from "../../src/domain/relics.ts";
import type { OwnedRiven } from "../../src/domain/rivens.ts";

const BASE = "/Lotus/Upgrades/Mods/Randomized/";

const riven = (patch: Partial<OwnedRiven>): OwnedRiven => ({
  item_id: "",
  item_type: `${BASE}LotusRifleRandomModRare`,
  mod_name: "",
  riven_state: "unlocked",
  compat: null,
  challenge_type: null,
  challenge_complication: null,
  lvl_req: null,
  polarity: null,
  buffs: [],
  curses: [],
  mod_rank: 0,
  count: 1,
  rerolls: 0,
  ...patch,
});

const OWNED: OwnedRiven[] = [
  riven({ item_id: "a", compat: "/Weapons/Soma", mod_name: "acri-visitis", polarity: "AP_ATTACK", mod_rank: 8, rerolls: 14 }),
  riven({ item_id: "b", item_type: `${BASE}LotusPistolRandomModRare`, compat: "/Weapons/Unknown", mod_name: "crita-tis", mod_rank: 3 }),
  riven({ item_id: "c", item_type: `${BASE}LotusMeleeRandomModRare`, riven_state: "revealed" }),
  riven({ item_type: `${BASE}RawShotgunRandomMod`, riven_state: "unrevealed", count: 2 }),
  riven({ item_type: `${BASE}RawShotgunRandomMod`, riven_state: "unrevealed", count: 1 }),
];

const CATALOG: CatalogItem[] = [
  { unique_name: `${BASE}LotusRifleRandomModRare`, name: "Rifle Riven Mod", category: "Mods" },
  { unique_name: `${BASE}RawRifleRandomMod`, name: "Rifle Riven Mod", category: "Mods" },
  { unique_name: `${BASE}RawShotgunRandomMod`, name: "Shotgun Riven Mod", category: "Mods" },
  { unique_name: "/Mods/Serration", name: "Serration", category: "Mods" },
];

const names = new Map([["/Weapons/Soma", "Soma"]]);
const cards = ownRivenCards(OWNED, names);
const veiled = veiledCounts(OWNED);
const ctx = { meta: {}, price: (i: CatalogItem) => (i.unique_name.endsWith("RawRifleRandomMod") ? 30 : 0) };
const f = (patch: Partial<ModFilters>): ModFilters => ({ ...DEFAULT_MOD_FILTERS, group: "mod-riven", ...patch });
const label = (e: RivenEntry) => (e.kind === "riven" ? e.riven.name : `${e.item.name} (Veiled) ×${String(e.count)}`);
const shown = (patch: Partial<ModFilters>) => visibleRivens(CATALOG, cards, veiled, f(patch), ctx).map(label);

describe("riven cards", () => {
  it("names unlocked rivens as the game does and revealed ones by type", () => {
    expect(cards.map((c) => c.name)).toEqual(["Soma Acri-visitis", "Unknown Crita-tis", "Melee Riven Mod"]);
    expect(cards[0]?.subline).toBe("Rifle riven · Madurai");
    expect(cards[2]?.subline).toBe("Melee riven");
  });

  it("shows rank and rerolls, or the state of a revealed riven", () => {
    expect(cards[0] && rivenRows(cards[0])).toEqual([
      { label: "Rank", value: "8/8" },
      { label: "Rerolls", value: "14" },
    ]);
    expect(cards[2] && rivenRows(cards[2])).toEqual([{ label: "State", value: "Challenge to complete" }]);
  });

  it("counts veiled rivens per type", () => {
    expect(veiled.get(`${BASE}RawShotgunRandomMod`)).toBe(3);
  });

  it("lists your rivens and the veiled placeholders, not the unveiled placeholders", () => {
    expect(shown({ sort: "az" })).toEqual([
      "Melee Riven Mod",
      "Rifle Riven Mod (Veiled) ×0",
      "Shotgun Riven Mod (Veiled) ×3",
      "Soma Acri-visitis",
      "Unknown Crita-tis",
    ]);
    expect(rivenGroupCount(visibleRivens(CATALOG, cards, veiled, f({}), ctx))).toEqual({ owned: 4, total: 5 });
  });

  it("applies owned, incomplete, rank, polarity and search", () => {
    expect(shown({ owned: true, sort: "az" })).not.toContain("Rifle Riven Mod (Veiled) ×0");
    expect(shown({ incomplete: true, sort: "az" })).toEqual(["Melee Riven Mod", "Unknown Crita-tis"]);
    expect(shown({ ranks: [8] })).toEqual(["Soma Acri-visitis"]);
    expect(shown({ ranks: ["unranked"], sort: "az" })).toEqual(["Melee Riven Mod", "Shotgun Riven Mod (Veiled) ×3"]);
    expect(shown({ polarity: ["madurai"] })).toEqual(["Soma Acri-visitis"]);
    expect(shown({ search: "soma" })).toEqual(["Soma Acri-visitis"]);
    expect(shown({ search: "shotgun" })).toEqual(["Shotgun Riven Mod (Veiled) ×3"]);
    expect(shown({ traits: ["augment"] })).toEqual([]);
  });

  it("sorts by count, platinum and name", () => {
    expect(shown({ sort: "qty" })[0]).toBe("Shotgun Riven Mod (Veiled) ×3");
    expect(shown({ sort: "plat" })[0]).toBe("Rifle Riven Mod (Veiled) ×0");
    expect(shown({ sort: "za" })[0]).toBe("Unknown Crita-tis");
  });
});
