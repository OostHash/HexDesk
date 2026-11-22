import { describe, expect, it } from "vitest";
import {
  eraLabel,
  pickLinesFrom,
  pickPriorityFrom,
  PREVIEW_PICK,
  recommendedRefinement,
  refinementLabel,
  scoreLabel,
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
    expect(scoreLabel(axi, "unowned")).toBe("38% new");
    expect(scoreLabel(meso, "ducat")).toBe("26 ducats EV");
    expect(scoreLabel(lith, "platinum")).toBe("3p EV");
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

it("recommends a refinement by rarity", () => {
  expect(recommendedRefinement("Gold")).toBe("Radiant");
  expect(recommendedRefinement("Silver")).toBe("Exceptional");
  expect(recommendedRefinement("Bronze")).toBe("Intact");
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
