import { describe, expect, it } from "vitest";
import {
  batchCounts,
  changeKey,
  describeChange,
  filterChanges,
  formatChangeTime,
  formatClockTime,
  latestBatch,
  maxLogHeight,
  startsBatch,
} from "../../src/domain/changelog";
import type { ChangeEntry } from "../../src/domain/inventory";

const change = (unique_name: string, delta: number, timestamp: number, extra: Partial<ChangeEntry> = {}): ChangeEntry => ({
  unique_name,
  item_name: unique_name.split("/").pop() ?? unique_name,
  delta,
  timestamp,
  ...extra,
});

const LOG = [change("/a", 5, 1000), change("/b", -2, 995), change("/c", 1, 992), change("/d", 3, 900)];

describe("latestBatch", () => {
  it("takes changes until a gap of more than 8 seconds", () => {
    expect(latestBatch(LOG).map((c) => c.unique_name)).toEqual(["/a", "/b", "/c"]);
  });
  it("is empty without changes", () => {
    expect(latestBatch([])).toEqual([]);
  });
});

it("counts increases and decreases", () => {
  expect(batchCounts(latestBatch(LOG))).toEqual({ up: 2, down: 1 });
});

it("marks where a new batch starts", () => {
  expect(LOG.map((_, i) => startsBatch(LOG, i))).toEqual([false, false, false, true]);
});

it("keys changes by id, item and time", () => {
  expect(changeKey(change("/a", 1, 5, { id: 7 }))).toBe("7:/a:5");
  expect(changeKey(change("/a", 1, 5))).toBe("0:/a:5");
});

describe("names and search", () => {
  const items = new Map([["/a", { name: "Ferrite", category: "Resources" }]]);
  const lookup = (u: string) => items.get(u);
  it("uses the catalogue, else the logged name and Miscellaneous", () => {
    expect(describeChange(change("/a", 5, 1000), lookup("/a"))).toEqual({ name: "Ferrite", category: "Resources" });
    expect(describeChange(change("/b", -2, 995), undefined)).toEqual({ name: "b", category: "Miscellaneous" });
  });
  it("filters on name or category, ignoring case", () => {
    expect(filterChanges(LOG, lookup, "ferr").map((c) => c.unique_name)).toEqual(["/a"]);
    expect(filterChanges(LOG, lookup, "MISC")).toHaveLength(3);
    expect(filterChanges(LOG, lookup, "  ")).toBe(LOG);
  });
});

it("formats hours and minutes in the clock setting", () => {
  const t = Date.UTC(2026, 10, 12, 15, 4) / 1000;
  expect(formatClockTime(t, "24h", "en-GB")).toMatch(/^\d{2}:04$/);
  expect(formatClockTime(t, "12h", "en-US")).toMatch(/:04 (AM|PM)$/);
});

it("shows the day and month with the time of a change", () => {
  const t = Date.UTC(2026, 10, 19, 12, 4) / 1000;
  expect(formatChangeTime(t, "24h", "en-GB")).toMatch(/^(18|19|20) Nov · \d{2}:04$/);
});

it("caps the dock at 800 px or 80 % of the window, never below 100", () => {
  expect(maxLogHeight(1200)).toBe(800);
  expect(maxLogHeight(500)).toBe(400);
  expect(maxLogHeight(100)).toBe(100);
});
