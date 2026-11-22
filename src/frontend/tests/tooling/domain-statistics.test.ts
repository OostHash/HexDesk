import { describe, expect, it } from "vitest";
import {
  byCategory,
  clockFormatFrom,
  displayItemName,
  fmtK,
  groupSessions,
  inferCategory,
  inPeriod,
  moveTracked,
  orderTracked,
  share,
  signed,
  snapshotsIn,
  snapshotStats,
  topSold,
  topTraded,
  totals,
  trackCandidates,
  type Trade,
} from "../../src/domain/statistics.ts";

let n = 0;
const t = (p: Partial<Trade> & Pick<Trade, "direction" | "item_name" | "platinum">): Trade => ({
  id: ++n,
  timestamp: "2026-11-10T12:00:00Z",
  with_player: "Tenno",
  item_url: "",
  quantity: 1,
  source: "",
  notes: "",
  session_id: "",
  trade_type: "sale",
  ...p,
});

describe("trades", () => {
  const trades = [
    t({ direction: "sold", item_name: "Nova Prime Set", platinum: 100, quantity: 2 }),
    t({ direction: "bought", item_name: "Arcane Energize", platinum: 40 }),
    t({ direction: "traded-out", item_name: "Lith B1 Relic", platinum: 0, quantity: 5 }),
    t({ direction: "sold", item_name: "Nova Prime Set", platinum: 90, timestamp: "2026-09-01T00:00:00Z" }),
  ];

  it("cleans rank stars", () => {
    expect(displayItemName(`Serration${String.fromCharCode(0xe000).repeat(3)}`)).toBe("Serration (R3)");
    expect(displayItemName("  Ferrite ")).toBe("Ferrite");
  });

  it("keeps trades within the period", () => {
    const now = new Date("2026-11-12T00:00:00Z").getTime();
    expect(inPeriod(trades, 30, now)).toHaveLength(3);
    expect(inPeriod(trades, "all", now)).toHaveLength(4);
  });

  it("totals revenue, expenses and profit as platinum × quantity", () => {
    expect(totals(trades.slice(0, 3))).toEqual({ revenue: 200, expenses: 40, profit: 160 });
  });

  it("infers categories from the name", () => {
    expect(["Kuva Riven Mod", "Arcane Grace", "Lith B1 Relic", "Ash Prime Set", "Vitality Mod", "Ferrite"].map(inferCategory)).toEqual([
      "Riven",
      "Arcane",
      "Relic",
      "Prime",
      "Mod",
      "Other",
    ]);
    expect(inferCategory("Kuva Set")).toBe("Set");
  });

  it("sorts categories by profit and items by value", () => {
    expect(byCategory(trades).map((c) => [c.category, c.profit])).toEqual([
      ["Prime", 290],
      ["Relic", 0],
      ["Arcane", -40],
    ]);
    // traded-out counts as a sale.
    expect(topSold(trades)).toEqual([
      { item_name: "Nova Prime Set", quantity: 3, total_plat: 290 },
      { item_name: "Lith B1 Relic", quantity: 5, total_plat: 0 },
    ]);
    expect(topTraded(trades).map((i) => i.item_name)).toEqual(["Nova Prime Set", "Arcane Energize", "Lith B1 Relic"]);
  });

  it("groups sessions and keeps legacy rows apart, newest first", () => {
    const rows = [
      t({ session_id: "s", direction: "traded-out", item_name: "A", platinum: 0, trade_type: "trade", timestamp: "2026-11-11T00:00:00Z" }),
      t({ session_id: "s", direction: "traded-in", item_name: "B", platinum: 0, trade_type: "trade", timestamp: "2026-11-11T00:00:00Z" }),
      t({ direction: "bought", item_name: "C", platinum: 30, timestamp: "2026-11-01T00:00:00Z" }),
    ];
    const s = groupSessions(rows);
    expect(s.map((x) => x.tradeType)).toEqual(["trade", "purchase"]);
    expect(s[0]).toMatchObject({ givenItems: [{ name: "A", qty: 1 }], receivedItems: [{ name: "B", qty: 1 }] });
    expect(s[1]).toMatchObject({ givenPlat: 30, receivedItems: [{ name: "C", qty: 1 }] });
  });

  it("formats with thousands separators below 10K and K above", () => {
    expect(fmtK(9_999)).toBe("9,999");
    expect(fmtK(12_450)).toBe("12.4K");
    expect(signed(-40)).toBe("-40");
    expect(signed(0)).toBe("+0");
    expect(share(50, 200)).toBe(0.25);
    expect(share(-5, 200)).toBe(0);
    expect(clockFormatFrom("12h")).toBe("12h");
    expect(clockFormatFrom(1)).toBe("auto");
  });
});

describe("item report", () => {
  const points = [
    { date: "2026-10-01", quantity: 100, change: 0 },
    { date: "2026-11-05", quantity: 90, change: -10 },
    { date: "2026-11-10", quantity: 95, change: 5 },
    { date: "2026-11-11", quantity: 95, change: 0 },
  ];

  it("keeps the timeframe and computes current, average and total", () => {
    const week = snapshotsIn(points, 7, new Date("2026-11-12T12:00:00Z"));
    expect(week.map((p) => p.date)).toEqual(["2026-11-05", "2026-11-10", "2026-11-11"]);
    expect(snapshotStats(week)).toEqual({ current: 95, avgPerDay: 3, total: 5 });
    expect(
      snapshotStats([
        { date: "x", quantity: 4, change: 0 },
        { date: "y", quantity: 4, change: -1 },
        { date: "z", quantity: 4, change: 0 },
      ]).avgPerDay,
    ).toBe(0);
    expect(snapshotStats([])).toEqual({ current: null, avgPerDay: null, total: null });
  });

  it("finds untracked items: exact, then starts-with, then A–Z", () => {
    const catalog = [
      { unique_name: "a", name: "Ferrite Ore" },
      { unique_name: "b", name: "Alloy Ferrite" },
      { unique_name: "c", name: "Ferrite" },
      { unique_name: "d", name: "Ferrite Cell" },
    ];
    expect(trackCandidates(catalog, new Set(["d"]), "ferrite").map((c) => c.name)).toEqual(["Ferrite", "Ferrite Ore", "Alloy Ferrite"]);
    expect(trackCandidates(catalog, new Set(), " ")).toEqual([]);
  });

  it("orders cards and moves them", () => {
    const items = ["x", "y", "z"].map((id) => ({ unique_name: id, display_name: id, added_at: "" }));
    expect(orderTracked(items, ["z", "x"]).map((i) => i.unique_name)).toEqual(["z", "x", "y"]);
    expect(moveTracked(items, ["z", "x"], "y", -1)).toEqual(["z", "y", "x"]);
    expect(moveTracked(items, [], "x", -1)).toEqual(["x", "y", "z"]);
  });
});
