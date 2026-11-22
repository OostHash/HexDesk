import { describe, expect, it } from "vitest";
import {
  bestPick,
  cardWidth,
  cardsFrom,
  cellLabel,
  columnCenters,
  overlayPriorityFrom,
  PREVIEW_CARDS,
  rewardSummary,
  setPlatinum,
  stripBounds,
  type BackendCard,
  type RewardCard,
} from "../../src/domain/relicReward";

describe("cells", () => {
  it("label cells without the set name or a trailing Blueprint", () => {
    expect(cellLabel("Rhino Prime Chassis Blueprint", "Rhino Prime")).toBe("Chassis");
    expect(cellLabel("Rhino Prime Blueprint", "Rhino Prime")).toBe("Blueprint");
  });
  it("add up missing and total platinum from known prices", () => {
    expect(
      setPlatinum([
        { unique_name: "a", name: "A", needed: 2, owned: 1, plat: 10 },
        { unique_name: "b", name: "B", needed: 1, owned: 0 },
      ]),
    ).toEqual({ missing: 10, total: 20 });
  });
});

describe("bestPick", () => {
  const card = (extra: Partial<RewardCard>): RewardCard => ({ key: "k", name: "X", unknown: false, ...extra });
  it("follows the priority", () => {
    const cards = [card({ plat: 5, ducats: 100 }), card({ plat: 30, ducats: 15 })];
    expect(bestPick(cards, "plat")).toBe(1);
    expect(bestPick(cards, "ducat")).toBe(0);
    expect(bestPick([card({ plat: 5, missingPlat: 50 }), card({ plat: 30 })], "setPlat")).toBe(0);
  });
  it("on completion prefers the part you still need most", () => {
    expect(bestPick(PREVIEW_CARDS, "completion")).toBe(0);
  });
  it("picks nothing when every score is 0 or less", () => {
    expect(bestPick([card({}), card({ plat: 0 })], "plat")).toBe(-1);
  });
  it("reads the priority setting", () => {
    expect(overlayPriorityFrom("ducat")).toBe("ducat");
    expect(overlayPriorityFrom("bogus")).toBe("completion");
  });
});

describe("layout", () => {
  it("places columns like the game's slots", () => {
    expect(columnCenters(1000, 1)).toEqual([500]);
    expect(columnCenters(1000, 2)).toEqual([436.5, 563.5]);
    expect(columnCenters(1000, 4)).toEqual([309.5, 436.5, 563.5, 690.5]);
    expect(cardWidth(1920)).toBe(234);
    expect(cardWidth(400)).toBe(80);
  });
  it("puts the strip over the game, never past its bottom", () => {
    expect(stripBounds([100, 50, 1920, 1080], { top: 0.6, height: 0.3 }, 1)).toEqual({ x: 100, y: 698, w: 1920, h: 324 });
    expect(stripBounds([0, 0, 1920, 1080], { top: 0.6, height: 0.3 }, 2)).toEqual({ x: 0, y: 648, w: 1920, h: 432 });
  });
});

it("adds prices and set value to the backend's cards", () => {
  const backend: BackendCard[] = [
    {
      path: "/Lotus/Recipes/RhinoPrimeChassisBlueprint",
      name: "Rhino Prime Chassis Blueprint",
      unknown: false,
      category: "Blueprints",
      vaulted: true,
      ducats: 45,
      set_name: "Rhino Prime",
      parts: [
        { path: "/Lotus/Recipes/RhinoPrimeBlueprint", name: "Rhino Prime Blueprint", needed: 1, owned: { total: 1 }, ducats: 15 },
        { path: "/Lotus/Parts/RhinoPrimeChassis", name: "Rhino Prime Chassis", needed: 1, owned: { total: 0 }, ducats: null },
      ],
      built: { total: 0 },
      complete_sets: 0,
    },
    {
      path: "?:Mystery",
      name: "Mystery",
      unknown: true,
      category: null,
      vaulted: null,
      ducats: null,
      set_name: null,
      parts: null,
      built: null,
      complete_sets: null,
    },
  ];
  const cards = cardsFrom(
    backend,
    new Map([
      ["Rhino Prime Chassis Blueprint", 9],
      ["Rhino Prime Blueprint", 20],
      ["Rhino Prime Chassis", 9],
    ]),
  );
  expect(cards[0]).toMatchObject({
    name: "Rhino Prime Chassis Blueprint",
    plat: 9,
    ducats: 45,
    setName: "Rhino Prime",
    completeSets: 0,
    totalPlat: 29,
    missingPlat: 9,
  });
  expect(cards[1]).toMatchObject({ name: "Mystery", unknown: true, category: "Unrecognized" });
});

describe("rewardSummary", () => {
  it("says per card what the overlay shows and which parts are owned", () => {
    expect(rewardSummary(PREVIEW_CARDS.slice(0, 3))).toBe(
      "Rhino Prime Blueprint 20p: full item not owned (Blueprint 0/1, Chassis Blueprint 1/1, Neuroptics Blueprint 0/1, Systems Blueprint 1/1)" +
        " | Nyx Prime Neuroptics Blueprint 30p: full item owned (Blueprint 1/1, Chassis Blueprint 1/1, Neuroptics Blueprint 1/1, Systems Blueprint 1/1)" +
        " | Glaive Prime Disc 9p",
    );
  });
});
