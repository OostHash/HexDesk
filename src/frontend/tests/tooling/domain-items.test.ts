import { describe, expect, it } from "vitest";
import {
  cardSubline,
  modGroups,
  formatChance,
  formatDrain,
  inModGroup,
  isIncomplete,
  itemRows,
  limitRows,
  modDisplayName,
  modGroup,
  rankRows,
  startRank,
  type CardMeta,
} from "../../src/domain/items.ts";

const meta = (patch: Partial<CardMeta>): CardMeta => ({
  rarity: "Rare",
  polarity: "madurai",
  compat: "Rifle",
  type_name: "Primary Mod",
  max_rank: 10,
  augment: false,
  exilus: false,
  utility: false,
  damage_types: [],
  effect: [],
  ...patch,
});

describe("card subline", () => {
  it("names what a mod fits and its polarity", () => {
    expect(cardSubline("Mods", meta({}))).toBe("Rifle · Madurai");
    expect(cardSubline("Mods", meta({ augment: true, compat: "Trinity" }))).toBe("Augment · Trinity · Madurai");
  });

  it("names the arcane type", () => {
    expect(cardSubline("Arcanes", meta({ type_name: "Warframe Arcane" }))).toBe("Warframe arcane");
  });

  it("falls back to the category", () => {
    expect(cardSubline("Primary", undefined)).toBe("Primary");
    expect(cardSubline("Mods", meta({ compat: null, polarity: null }))).toBe("Mods");
  });
});

describe("card rows", () => {
  it("lists owned ranks lowest first and marks the max rank", () => {
    expect(rankRows({ "10": 1, "0": 57, "3": 0 }, 10)).toEqual([
      { label: "Unranked", value: "57" },
      { label: "Rank 10 (max)", value: "1" },
    ]);
  });

  it("collapses rows past the limit into one", () => {
    const rows = rankRows({ "0": 1, "1": 1, "2": 1, "3": 1, "4": 1, "5": 1 }, 5);
    const limited = limitRows(rows);
    expect(limited).toHaveLength(4);
    expect(limited[3]).toEqual({ label: "+3 more", value: "", muted: true });
    expect(limitRows(rows.slice(0, 4))).toHaveLength(4);
  });

  it("shows mastery, required rank and the Foundry for levelled items", () => {
    expect(itemRows({ masterable: true, mastery_req: 8 }, 30, true)).toEqual([
      { label: "Mastery", value: "Mastered" },
      { label: "Requires", value: "MR 8" },
      { label: "Foundry", value: "Building" },
    ]);
    expect(itemRows({ masterable: true }, 12, false)).toEqual([{ label: "Mastery", value: "Rank 12" }]);
    expect(itemRows({ masterable: null, mastery_req: 0 }, 0, false)).toEqual([]);
  });
});

describe("info window values", () => {
  it("starts at the highest owned rank", () => {
    expect(startRank({ "0": 4, "5": 1, "10": 0 }, 10)).toBe(5);
    expect(startRank(undefined, 10)).toBe(0);
    expect(startRank({ "12": 1 }, 10)).toBe(10);
  });

  it("formats chances and drain", () => {
    expect(formatChance(0.0912)).toBe("0.09%");
    expect(formatChance(8.6)).toBe("8.6%");
    expect(formatChance(5)).toBe("5%");
    expect(formatDrain(14)).toBe("14");
    expect(formatDrain(-7)).toBe("+7");
  });
});

describe("mod groups", () => {
  it("groups WFCD types into navigator entries", () => {
    expect(modGroup({ category: "Mods", unique_name: "/x" }, meta({ type_name: "Shotgun Mod" }))).toBe("mod-primary");
    expect(modGroup({ category: "Mods", unique_name: "/x" }, meta({ type_name: "Stance Mod" }))).toBe("mod-stance");
    expect(modGroup({ category: "Mods", unique_name: "/x" }, meta({ type_name: "Plexus Mod" }))).toBe("mod-railjack");
    expect(modGroup({ category: "Arcanes", unique_name: "/x" }, meta({ type_name: "Amp Arcane" }))).toBe("arcane-operator");
  });

  it("puts unknown types under Other of their kind", () => {
    expect(modGroup({ category: "Mods", unique_name: "/x" }, meta({ type_name: "Parazon Mod" }))).toBe("mod-parazon");
    expect(modGroup({ category: "Mods", unique_name: "/x" }, meta({ type_name: "Focus Way" }))).toBe("mod-other");
    expect(modGroup({ category: "Arcanes", unique_name: "/x" }, undefined)).toBe("arcane-other");
  });

  it("matches the all, mods and arcanes entries by kind", () => {
    expect(inModGroup("all", { category: "Arcanes", unique_name: "/x" }, undefined)).toBe(true);
    expect(inModGroup("mods", { category: "Mods", unique_name: "/x" }, undefined)).toBe(true);
    expect(inModGroup("mods", { category: "Arcanes", unique_name: "/x" }, undefined)).toBe(false);
  });
});

describe("rivens and incomplete mods", () => {
  const veiled = { category: "Mods", unique_name: "/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod", name: "Rifle Riven Mod" };
  const unveiled = { category: "Mods", unique_name: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", name: "Rifle Riven Mod" };

  it("puts every riven in the Rivens group and names veiled ones", () => {
    expect(modGroup(veiled, meta({ type_name: "Rifle Riven Mod" }))).toBe("mod-riven");
    expect(modGroup(unveiled, undefined)).toBe("mod-riven");
    expect(modDisplayName(veiled)).toBe("Rifle Riven Mod (Veiled)");
    expect(modDisplayName(unveiled)).toBe("Rifle Riven Mod");
  });

  it("calls a mod incomplete while no owned copy is at the max rank", () => {
    expect(isIncomplete({ "0": 3, "5": 1 }, 10)).toBe(true);
    expect(isIncomplete({ "0": 3, "10": 1 }, 10)).toBe(false);
    expect(isIncomplete({}, 10)).toBe(false);
    expect(isIncomplete({ "0": 1 }, undefined)).toBe(false);
  });
});

describe("game-style mod groups", () => {
  it("puts auras in Aura, not Warframe", () => {
    const aura = { category: "Mods", unique_name: "/Lotus/Upgrades/Mods/Aura/PlayerMeleeAuraMod" };
    expect(modGroup(aura, meta({ type_name: "Warframe Mod", compat: "Aura" }))).toBe("mod-aura");
  });

  it("lists exilus mods in Exilus as well as their own type", () => {
    const item = { category: "Mods", unique_name: "/Lotus/Upgrades/Mods/Rifle/Exilus" };
    expect(modGroups(item, meta({ type_name: "Primary Mod", utility: true }))).toEqual(["all", "mods", "mod-primary", "mod-exilus"]);
    expect(modGroups(item, meta({ type_name: "Warframe Mod", exilus: true }))).toContain("mod-exilus");
    expect(modGroups(item, meta({ type_name: "Primary Mod" }))).not.toContain("mod-exilus");
  });
});
