import { describe, expect, it } from "vitest";
import {
  activeAuctions,
  auctionName,
  auctionPrice,
  tradeLogRows,
  completeWhisper,
  GHOST_MS,
  inviteText,
  isRivenOrder,
  matchSale,
  orderName,
  pruneGhosts,
  revertAction,
  revertHint,
  saleAction,
  soldText,
  type WfmAuction,
  type WfmManagedOrder,
  type Whisper,
} from "../../src/domain/trading.ts";

const order = (id: string, item: WfmManagedOrder["item"], patch: Partial<WfmManagedOrder> = {}): WfmManagedOrder => ({
  id,
  type: "sell",
  platinum: 20,
  quantity: 2,
  visible: true,
  item,
  ...patch,
});
const names = new Map([["id-ash", "Ash Prime Set"]]);

describe("order names", () => {
  it("reads whichever field the API filled", () => {
    expect(orderName(order("1", { i18n: { en: { name: "Nova Prime Set" } } }), names)).toBe("Nova Prime Set");
    expect(orderName(order("2", { slug: "braton_prime_barrel" }), names)).toBe("Braton Prime Barrel");
    expect(orderName(order("3", undefined, { itemId: "id-ash" }), names)).toBe("Ash Prime Set");
    expect(orderName(order("4", undefined), names)).toBe("—");
  });

  it("splits rivens off", () => {
    expect(isRivenOrder(order("1", { slug: "rifle_riven_mod_veiled" }), names)).toBe(true);
    expect(isRivenOrder(order("2", { slug: "serration" }), names)).toBe(false);
  });

  it("names and prices auctions", () => {
    const a: WfmAuction = {
      id: "a",
      starting_price: 100,
      buyout_price: 300,
      top_bid: null,
      bids: 0,
      is_closed: false,
      is_direct_sell: false,
      visible: false,
      item: { weapon_url_name: "soma_prime", name: "critaata" },
    };
    expect(auctionName(a)).toEqual({ weapon: "Soma Prime", mod: "Critaata" });
    expect(auctionPrice(a)).toBe(100);
    expect(auctionPrice({ ...a, is_direct_sell: true })).toBe(300);
    expect(activeAuctions([a, { ...a, id: "b", visible: true }, { ...a, id: "c", is_closed: true }]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("whispers", () => {
  const w = (id: string, from: string, completedAt?: number): Whisper => ({
    id,
    from,
    message: "",
    timestamp: "12:00",
    ...(completedAt !== undefined ? { completedAt } : {}),
  });

  it("completes the first open whisper of that player, case-insensitive", () => {
    const done = completeWhisper([w("1", "Tenno", 5), w("2", "tenno"), w("3", "Tenno")], "TENNO", 100);
    expect(done?.whisper.id).toBe("2");
    expect(done?.list.map((x) => x.completedAt)).toEqual([5, 100, undefined]);
    expect(completeWhisper([w("1", "Other")], "Tenno", 1)).toBeNull();
  });

  it("drops completed whispers after five minutes", () => {
    expect(pruneGhosts([w("1", "a", 0), w("2", "b")], GHOST_MS).map((x) => x.id)).toEqual(["2"]);
  });

  it("writes the whisper messages", () => {
    expect(inviteText("Tenno")).toBe("/w Tenno Hi! I'm online, come to my orbiter.");
    expect(soldText("Tenno", "Ash Prime Set")).toBe("/w Tenno Ash Prime Set sold! Thank you.");
    expect(soldText("Tenno")).toBe("/w Tenno Sold! Thank you.");
  });
});

describe("sales", () => {
  const set = order("set", { i18n: { en: { name: "Burston Prime Set" } } }, { itemId: "bset", quantity: 1 });
  const barrel = order("barrel", { i18n: { en: { name: "Burston Prime Barrel" } } }, { quantity: 3 });

  it("prefers the item from the whisper (a set arrives as its parts)", () => {
    const m = matchSale([set, barrel], names, "Burston Prime Set", [{ name: "Burston Prime Barrel", qty: 1 }]);
    expect(m.map((x) => [x.order.id, x.soldQty])).toEqual([["set", 1]]);
  });

  it("falls back to the traded items, exact then substring", () => {
    const m = matchSale([set, barrel], names, undefined, [
      { name: "burston prime barrel", qty: 2 },
      { name: "Unknown", qty: 1 },
    ]);
    expect(m.map((x) => [x.order.id, x.soldQty])).toEqual([["barrel", 2]]);
    expect(matchSale([barrel], names, undefined, [{ name: "Prime Barrel", qty: 1 }])).toHaveLength(1);
  });

  const revertOf = (r: ReturnType<typeof saleAction>) => {
    if (!r.revert) throw new Error("no revert info");
    return r.revert;
  };

  it("lowers, deletes or closes the listing and can undo the first two", () => {
    const lower = saleAction({ order: barrel, soldQty: 1, itemName: "x" }, false);
    expect(lower.action).toEqual({ kind: "update", orderId: "barrel", platinum: 20, quantity: 2, visible: true });
    expect(revertAction(revertOf(lower))).toMatchObject({ kind: "update", quantity: 3 });
    expect(revertHint(revertOf(lower))).toBe("WFM quantity 3 → 2");

    const gone = saleAction({ order: set, soldQty: 1, itemName: "x" }, false);
    expect(gone.action).toEqual({ kind: "delete", orderId: "set" });
    expect(revertAction(revertOf(gone))).toEqual({ kind: "create", itemId: "bset", platinum: 20, quantity: 1, visible: true, modRank: null });

    const recorded = saleAction({ order: barrel, soldQty: 5, itemName: "x" }, true);
    expect(recorded).toMatchObject({ action: { kind: "close", quantity: 3 }, revert: undefined, newQty: 0 });
  });
});

describe("tradeLogRows", () => {
  const base = { withPlayer: "Tenno", sessionId: "s1", timestamp: "2026-11-12T12:00:00Z" };
  it("logs a sale as sold rows with the platinum on the first", () => {
    const rows = tradeLogRows({
      ...base,
      tradeType: "sale",
      offeredItems: [
        { name: "Serration", qty: 1 },
        { name: "Ferrite", qty: 10 },
      ],
      receivedPlat: 25,
    });
    expect(rows.map((r) => [r.direction, r.itemName, r.quantity, r.platinum])).toEqual([
      ["sold", "Serration", 1, 25],
      ["sold", "Ferrite", 10, 0],
    ]);
    expect(rows[0]).toMatchObject({ source: "in-game", sessionId: "s1", tradeType: "sale", timestamp: "2026-11-12T12:00:00Z" });
  });
  it("logs a purchase as bought rows with the platinum paid", () => {
    const rows = tradeLogRows({ ...base, tradeType: "purchase", offeredItems: [], receivedItems: [{ name: "Vitality", qty: 1 }], offeredPlat: 8 });
    expect(rows.map((r) => [r.direction, r.itemName, r.platinum])).toEqual([["bought", "Vitality", 8]]);
  });
  it("logs a swap as traded-out and traded-in", () => {
    const rows = tradeLogRows({ ...base, tradeType: "trade", offeredItems: [{ name: "A", qty: 1 }], receivedItems: [{ name: "B", qty: 2 }] });
    expect(rows.map((r) => [r.direction, r.itemName, r.quantity])).toEqual([
      ["traded-out", "A", 1],
      ["traded-in", "B", 2],
    ]);
  });
});
