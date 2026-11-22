import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER,
  clockTime,
  entryLine,
  filterEntries,
  logTime,
  mergeEntries,
  sourcesOf,
  type ConsoleFilter,
  type LogEntry,
} from "../../src/domain/console";

const entry = (id: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id,
  time: "2026-11-18T15:03:12.481234+01:00",
  level: "info",
  source: "scanner",
  code: null,
  message: `Entry ${String(id)}`,
  fields: {},
  causes: [],
  op: null,
  repeat: null,
  ...extra,
});

const filter = (extra: Partial<ConsoleFilter>): ConsoleFilter => ({ ...DEFAULT_FILTER, ...extra });

describe("filtering", () => {
  const entries = [
    entry(1, { level: "error", source: "market", code: "market.denied", fields: { status: "401" } }),
    entry(2, { level: "debug", op: 42 }),
    entry(3, { level: "trace", op: 42 }),
    entry(4, { level: "warn", source: "overlay", causes: ["Warframe window not found"] }),
    entry(5, { repeat: { of: 2, count: 3, until: "2026-11-18T15:04:00+01:00", last_op: 42 } }),
  ];

  it("hides debug entries by default", () => {
    expect(filterEntries(entries, DEFAULT_FILTER).map((e) => e.id)).toEqual([1, 4, 5]);
  });

  it("counts trace as debug", () => {
    expect(filterEntries(entries, filter({ levels: new Set(["debug"]) })).map((e) => e.id)).toEqual([2, 3]);
  });

  it("filters on one or more sources", () => {
    expect(filterEntries(entries, filter({ sources: new Set(["overlay"]) })).map((e) => e.id)).toEqual([4]);
    expect(filterEntries(entries, filter({ sources: new Set(["overlay", "market"]) })).map((e) => e.id)).toEqual([1, 4]);
  });

  it("filters on one operation, including its repeat line", () => {
    const all = new Set(["error", "warn", "info", "debug"] as const);
    expect(filterEntries(entries, filter({ levels: all, op: 42 })).map((e) => e.id)).toEqual([2, 3, 5]);
  });

  it("searches message, code, fields and causes", () => {
    expect(filterEntries(entries, filter({ text: "status=401" })).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, filter({ text: "MARKET.DENIED" })).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, filter({ text: "window not found" })).map((e) => e.id)).toEqual([4]);
  });

  it("lists sources sorted", () => {
    expect(sourcesOf(entries)).toEqual(["market", "overlay", "scanner"]);
  });
});

describe("merging", () => {
  it("adds new entries in id order without duplicates", () => {
    const merged = mergeEntries([entry(1), entry(3)], [entry(2), entry(3)]);
    expect(merged.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("drops the oldest past the limit", () => {
    const merged = mergeEntries([entry(1), entry(2)], [entry(3)], 2);
    expect(merged.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("log lines", () => {
  it("formats times like the log file", () => {
    expect(logTime("2026-11-18T15:03:12.481234+01:00")).toBe("2026-11-18 15:03:12.481 +01:00");
    expect(logTime("2026-11-18T15:03:12Z")).toBe("2026-11-18 15:03:12.000 +00:00");
    expect(clockTime("2026-11-18T15:03:12.481+01:00")).toBe("15:03:12");
  });

  it("matches the backend line format", () => {
    const line = entryLine(
      entry(7, {
        level: "warn",
        op: 42,
        code: "scanner.not_found",
        message: "Account blob not found: 0 of 412 memory regions matched",
        fields: { attempt: "3/3", item: "ash prime" },
        causes: ["ReadProcessMemory failed (os error 299)"],
      }),
    );
    const [first, second] = line.split("\n");
    expect(first).toBe(
      '2026-11-18 15:03:12.481 +01:00 WARN  scanner    #42    Account blob not found: 0 of 412 memory regions matched  attempt=3/3 item="ash prime" [scanner.not_found]',
    );
    expect(second?.indexOf("caused by:")).toBe(first?.indexOf("Account"));
  });

  it("writes repeat lines", () => {
    const line = entryLine(entry(8, { repeat: { of: 7, count: 36, until: "2026-11-18T15:09:44+01:00", last_op: 78 } }));
    expect(line.endsWith("Entry 8 … repeated 36 times until 15:09:44, last in #78")).toBe(true);
  });

  it("keeps a message or cause with line breaks on its own line", () => {
    const line = entryLine(entry(9, { message: "first\nsecond", causes: ["a\r\nb"] }));
    expect(line.split("\n")).toHaveLength(2);
    expect(line).toContain(String.raw`first\nsecond`);
    expect(line.endsWith(String.raw`caused by: a\nb`)).toBe(true);
  });
});
