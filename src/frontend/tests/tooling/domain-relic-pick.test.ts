import { describe, expect, it } from "vitest";
import {
  eraLabel,
  pickLinesFrom,
  pickPriorityFrom,
  PREVIEW_PICK,
  dropChance,
  rarityLabel,
  refinementLabel,
  scoreHeadline,
  shownRewards,
  topRelics,
} from "../../src/domain/relicPick";

const relic = (name: string) => {
  const found = PREVIEW_PICK.relics.find((r) => r.base_name === name);
  if (!found) throw new Error(`no ${name} in the preview`);
  return found;
};
const axi = relic("Axi R4");
const meso = relic("Meso N1");
const lith = relic("Lith S1");

describe("ranking", () => {
  it("takes the top three for the priority", () => {
    expect(topRelics(PREVIEW_PICK, "unowned").map((r) => r.base_name)).toEqual(["Axi R4", "Meso N1", "Lith S1"]);
    expect(topRelics(PREVIEW_PICK, "ducat").map((r) => r.base_name)).toEqual(["Meso N1", "Axi R4", "Lith S1"]);
    expect(topRelics(PREVIEW_PICK, "platinum").map((r) => r.base_name)).toEqual(["Axi R4", "Lith S1", "Meso N1"]);
    expect(topRelics({ era: "AXI", relics: [] }, "unowned")).toEqual([]);
  });

  it("does not recommend relics the complete list did not confirm", () => {
    const pick = { ...PREVIEW_PICK, relics: PREVIEW_PICK.relics.map((r) => (r.base_name === "Meso N1" ? { ...r, on_screen: false } : r)) };
    expect(topRelics(pick, "ducat").map((r) => r.base_name)).toEqual(["Axi R4", "Lith S1"]);
  });
  it("labels the score", () => {
    expect(scoreHeadline(axi, "unowned")).toEqual({ value: "38%", caption: "chance of something new" });
    expect(scoreHeadline(meso, "ducat")).toEqual({ value: "26", caption: "ducats per run, on average" });
    expect(scoreHeadline(lith, "platinum")).toEqual({ value: "3p", caption: "platinum per run, on average" });
  });
});

describe("shown rewards", () => {
  it("lists all rewards Gold first", () => {
    expect(shownRewards(axi, "all", "unowned").map((r) => r.rarity)).toEqual(["Gold", "Silver", "Silver", "Bronze", "Bronze", "Bronze"]);
  });
  it("shows the best one for platinum and ducats, and every unowned one by drop chance", () => {
    expect(shownRewards(axi, "best", "platinum").map((r) => r.name)).toEqual(["Rhino Prime Blueprint"]);
    expect(shownRewards(meso, "best", "ducat").map((r) => r.name)).toEqual(["Nyx Prime Neuroptics Blueprint"]);
    expect(shownRewards(axi, "best", "unowned").map((r) => r.name)).toEqual([
      "Burston Prime Blueprint",
      "Glaive Prime Disc",
      "Rhino Prime Blueprint",
    ]);
  });
});

it("names rarities and drop chances the way the game does", () => {
  expect(rarityLabel("Gold")).toBe("Rare");
  expect(rarityLabel("Silver")).toBe("Uncommon");
  expect(rarityLabel("Bronze")).toBe("Common");
  expect(dropChance(0.2533)).toBe("25%");
  expect(dropChance(0.11)).toBe("11%");
  expect(dropChance(0.02)).toBe("2%");
  expect(dropChance(0.0233)).toBe("2.3%");
});

it("reads settings and labels eras and refinements", () => {
  expect(pickPriorityFrom("ducat")).toBe("ducat");
  expect(pickPriorityFrom("x")).toBe("unowned");
  expect(pickLinesFrom("estimated")).toBe("estimated");
  expect(pickLinesFrom(undefined)).toBe("all");
  expect(eraLabel("ALL")).toBe("All Eras");
  expect(eraLabel("REQUIEM")).toBe("REQUIEM");
  expect(refinementLabel("flawless")).toBe("Flawless");
});
