import { describe, expect, it } from "vitest";
import {
  classifyOriginal,
  classifyStat,
  compareRolls,
  PREVIEW_VIEW,
  rivenSummary,
  savedRollLabel,
  verdictText,
  wantedNames,
  weaponTitle,
  type OverlayAnalysis,
} from "../../src/domain/rivenOverlay";

if (PREVIEW_VIEW.kind !== "result" || !PREVIEW_VIEW.analysis) throw new Error("the preview has an analysis");
const analysis: OverlayAnalysis = PREVIEW_VIEW.analysis;

it("sums up a view for the log", () => {
  expect(rivenSummary({ kind: "scanning", rollCount: 2 })).toBe("scanning, roll 2");
  expect(rivenSummary(PREVIEW_VIEW)).toBe("Tenora Prime: 4 stats, GOOD — usable");
});

describe("stat classes", () => {
  it("marks the new roll wanted, neutral, safe or harmful", () => {
    expect(classifyStat({ name: "Critical Chance", value: "+1", positive: true }, analysis)).toBe("wanted");
    expect(classifyStat({ name: "Multi-shot", value: "+1", positive: true }, analysis)).toBe("neutral");
    expect(classifyStat({ name: "Zoom", value: "-1", positive: false }, analysis)).toBe("safe");
    expect(classifyStat({ name: "Damage to Corpus", value: "-1", positive: false }, analysis)).toBe("harmful");
    expect(classifyStat({ name: "Zoom", value: "-1", positive: false }, null)).toBe("neutral");
  });
  it("splits missing groups into wanted names", () => {
    const wanted = wantedNames({ ...analysis, missing_positives: ["Multishot / Toxin"] });
    expect([...wanted].sort()).toEqual(["Critical Chance", "Damage to Grineer", "Multishot", "Toxin"]);
    expect(wantedNames(null).size).toBe(0);
  });
  it("marks the original roll by the full wanted list, never harmful", () => {
    const wanted = wantedNames(analysis);
    expect(classifyOriginal({ name: "Toxin", value: "+1", positive: true }, analysis, wanted)).toBe("wanted");
    expect(classifyOriginal({ name: "Multi-shot", value: "+1", positive: true }, analysis, wanted)).toBe("neutral");
    expect(classifyOriginal({ name: "Zoom", value: "-1", positive: false }, analysis, wanted)).toBe("safe");
    expect(classifyOriginal({ name: "Damage to Corpus", value: "-1", positive: false }, analysis, wanted)).toBe("neutral");
  });
});

it("writes the verdict as a sentence", () => {
  expect(verdictText("GOOD — usable")).toBe("Good — usable");
  expect(verdictText("GREAT")).toBe("Great");
});

it("compares a new roll with the original by wanted stats", () => {
  expect(compareRolls(2, 1)).toBe("better");
  expect(compareRolls(1, 1)).toBe("same");
  expect(compareRolls(0, 1)).toBe("worse");
});

it("titles the weapon and labels a saved roll", () => {
  expect(weaponTitle("tenora prime")).toBe("Tenora Prime");
  expect(weaponTitle("")).toBe("Riven Analyzer");
  expect(savedRollLabel("tenora prime", 4, new Date(2026, 10, 12))).toBe("Tenora prime · Roll #4 · 12 Nov");
});
