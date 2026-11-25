import { describe, expect, it } from "vitest";
import {
  cardSubline,
  formatChance,
  formatDrain,
  inModGroup,
  itemRows,
  limitRows,
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
    expect(modGroup("Mods", meta({ type_name: "Shotgun Mod" }))).toBe("mod-primary");
    expect(modGroup("Mods", meta({ type_name: "Stance Mod" }))).toBe("mod-melee");
    expect(modGroup("Mods", meta({ type_name: "Plexus Mod" }))).toBe("mod-railjack");
    expect(modGroup("Arcanes", meta({ type_name: "Amp Arcane" }))).toBe("arcane-operator");
  });

  it("puts unknown types under Other of their kind", () => {
    expect(modGroup("Mods", meta({ type_name: "Parazon Mod" }))).toBe("mod-other");
    expect(modGroup("Arcanes", undefined)).toBe("arcane-other");
  });

  it("matches the all, mods and arcanes entries by kind", () => {
    expect(inModGroup("all", "Arcanes", undefined)).toBe(true);
    expect(inModGroup("mods", "Mods", undefined)).toBe(true);
    expect(inModGroup("mods", "Arcanes", undefined)).toBe(false);
  });
});
