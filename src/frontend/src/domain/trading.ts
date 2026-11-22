/**
 * warframe.market trading (Market part 2).
 */

export type WfmStatus = "online" | "ingame" | "invisible" | "offline";
export const SETTABLE_STATUSES = ["online", "ingame", "invisible"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];
export const isSettable = (s: string): s is SettableStatus => (SETTABLE_STATUSES as readonly string[]).includes(s);
export const STATUS_LABEL: Readonly<Record<WfmStatus, string>> = { online: "Online", ingame: "In game", invisible: "Invisible", offline: "Offline" };

export type WfmManagedOrder = {
  id: string;
  itemId?: string;
  rank?: number;
  type: "sell" | "buy";
  platinum: number;
  quantity: number;
  visible: boolean;
  item?: { slug?: string; urlName?: string; url_name?: string; en?: { item_name: string }; i18n?: { en?: { name: string } } };
};

export type WfmAuction = {
  id: string;
  starting_price: number;
  buyout_price: number | null;
  top_bid: number | null;
  bids: number;
  is_closed: boolean;
  is_direct_sell: boolean;
  visible: boolean;
  item: { weapon_url_name: string; name: string; mod_rank?: number; re_rolls?: number };
};

export type RevertInfo = {
  orderId: string;
  itemId: string;
  platinum: number;
  originalQty: number;
  newQty: number;
  visible: boolean;
  modRank?: number;
};

export type Whisper = {
  /** Local id (the backend sends none). */
  id: string;
  from: string;
  message: string;
  item?: string;
  price?: number;
  timestamp: string;
  completedAt?: number;
  revertInfo?: RevertInfo;
};

export type ListingChange = {
  id: string;
  timestamp: number;
  action: "decreased" | "completed";
  itemName: string;
  withPlayer: string;
  platinum: number;
  oldQty: number;
  newQty: number;
  revertInfo?: RevertInfo;
  reverted?: boolean;
};

export type TradeCompleted = {
  withPlayer: string;
  tradeType: "sale" | "purchase" | "trade";
  offeredItems: Array<{ name: string; qty: number }>;
  /** Present on the real event (EE.log); the WFM handling does not need them. */
  sessionId?: string;
  offeredPlat?: number;
  receivedItems?: Array<{ name: string; qty: number }>;
  receivedPlat?: number;
  /** RFC 3339. */
  timestamp?: string;
};

export type TradeLogRow = {
  withPlayer: string;
  direction: "sold" | "bought" | "traded-out" | "traded-in";
  itemName: string;
  itemUrl: string;
  quantity: number;
  platinum: number;
  source: "in-game";
  notes: string;
  sessionId?: string;
  tradeType: TradeCompleted["tradeType"];
  timestamp?: string;
};

/**
 * Trade-log rows for a finished in-game trade: a sale
 * is one "sold" row per item with the platinum on the first, a purchase one
 * "bought" row per received item, a swap "traded-out" and "traded-in" rows.
 */
export function tradeLogRows(t: TradeCompleted): TradeLogRow[] {
  const base = {
    withPlayer: t.withPlayer,
    itemUrl: "",
    source: "in-game" as const,
    notes: "",
    tradeType: t.tradeType,
    ...(t.sessionId !== undefined ? { sessionId: t.sessionId } : {}),
    ...(t.timestamp !== undefined ? { timestamp: t.timestamp } : {}),
  };
  const row = (direction: TradeLogRow["direction"], item: { name: string; qty: number }, platinum: number): TradeLogRow => ({
    ...base,
    direction,
    itemName: item.name,
    quantity: item.qty,
    platinum,
  });
  const received = t.receivedItems ?? [];
  if (t.tradeType === "sale") return t.offeredItems.map((item, i) => row("sold", item, i === 0 ? (t.receivedPlat ?? 0) : 0));
  if (t.tradeType === "purchase") return received.map((item, i) => row("bought", item, i === 0 ? (t.offeredPlat ?? 0) : 0));
  return [...t.offeredItems.map((item) => row("traded-out", item, 0)), ...received.map((item) => row("traded-in", item, 0))];
}

const titleCase = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Display name from whichever field the WFM API filled. */
export function orderName(o: WfmManagedOrder, itemNames: ReadonlyMap<string, string>): string {
  return (
    o.item?.i18n?.en?.name ??
    o.item?.en?.item_name ??
    o.item?.urlName ??
    o.item?.url_name ??
    (o.item?.slug ? titleCase(o.item.slug) : null) ??
    (o.itemId ? itemNames.get(o.itemId) : undefined) ??
    "—"
  );
}

export function isRivenOrder(o: WfmManagedOrder, itemNames: ReadonlyMap<string, string>): boolean {
  const url = (o.item?.urlName ?? o.item?.url_name ?? o.item?.slug ?? "").toLowerCase();
  return url.includes("riven") || orderName(o, itemNames).toLowerCase().includes("riven");
}

export function auctionName(a: WfmAuction): { weapon: string; mod: string } {
  const mod = a.item.name ? a.item.name.charAt(0).toUpperCase() + a.item.name.slice(1) : "";
  return { weapon: titleCase(a.item.weapon_url_name), mod };
}

/** Open auctions, visible first. */
export const activeAuctions = (list: readonly WfmAuction[]) => list.filter((a) => !a.is_closed).sort((a, b) => Number(b.visible) - Number(a.visible));

export const auctionPrice = (a: WfmAuction) => (a.is_direct_sell ? (a.buyout_price ?? a.starting_price) : a.starting_price);

// ── Whisper texts ───────────────────────────────────────────────────────────

export const inviteText = (from: string) => `/w ${from} Hi! I'm online, come to my orbiter.`;
export const soldText = (from: string, item?: string) => (item ? `/w ${from} ${item} sold! Thank you.` : `/w ${from} Sold! Thank you.`);

/** Completed whispers stay as a "ghost" for five minutes. */
export const GHOST_MS = 5 * 60_000;
export const pruneGhosts = (list: readonly Whisper[], now: number) =>
  list.filter((w) => w.completedAt === undefined || now - w.completedAt < GHOST_MS);

/** Marks the first open whisper from this player completed; returns null if none. */
export function completeWhisper(list: readonly Whisper[], player: string, now: number): { list: Whisper[]; whisper: Whisper } | null {
  const idx = list.findIndex((w) => w.completedAt === undefined && w.from.toLowerCase() === player.toLowerCase());
  const found = list[idx];
  if (!found) return null;
  const whisper = { ...found, completedAt: now };
  return { list: list.map((w, i) => (i === idx ? whisper : w)), whisper };
}

// ── Sale → listing update ───────────────────────────────────────────────────

export type SaleMatch = { order: WfmManagedOrder; soldQty: number; itemName: string };

/**
 * Which of my sell orders a finished sale touches. A full set shows up in
 * EE.log as its parts, so the item from the whisper wins (one copy); else
 * each traded item, exact name first, then a substring match.
 */
export function matchSale(
  sellOrders: readonly WfmManagedOrder[],
  itemNames: ReadonlyMap<string, string>,
  whisperItem: string | undefined,
  offered: TradeCompleted["offeredItems"],
): SaleMatch[] {
  const name = (o: WfmManagedOrder) => orderName(o, itemNames).toLowerCase();
  const requested = whisperItem?.trim();
  if (requested) {
    const order = sellOrders.find((o) => name(o) === requested.toLowerCase());
    if (order) return [{ order, soldQty: 1, itemName: requested }];
  }
  const out: SaleMatch[] = [];
  for (const sold of offered) {
    const lower = sold.name.toLowerCase();
    const order = sellOrders.find((o) => name(o) === lower) ?? sellOrders.find((o) => name(o).includes(lower) || lower.includes(name(o)));
    if (order) out.push({ order, soldQty: sold.qty, itemName: sold.name });
  }
  return out;
}

export type SaleAction =
  | { kind: "close"; orderId: string; quantity: number }
  | { kind: "update"; orderId: string; platinum: number; quantity: number; visible: boolean }
  | { kind: "delete"; orderId: string };

/** What to send to warframe.market for one matched sale, and how to undo it. */
export function saleAction(match: SaleMatch, recordSales: boolean): { action: SaleAction; revert: RevertInfo | undefined; newQty: number } {
  const { order } = match;
  const closed = Math.min(order.quantity, match.soldQty);
  const newQty = order.quantity - closed;
  const revert: RevertInfo = {
    orderId: order.id,
    itemId: order.itemId ?? "",
    platinum: order.platinum,
    originalQty: order.quantity,
    newQty,
    visible: order.visible,
    ...(order.rank !== undefined ? { modRank: order.rank } : {}),
  };
  if (recordSales) return { action: { kind: "close", orderId: order.id, quantity: closed }, revert: undefined, newQty };
  if (newQty > 0)
    return { action: { kind: "update", orderId: order.id, platinum: order.platinum, quantity: newQty, visible: order.visible }, revert, newQty };
  return { action: { kind: "delete", orderId: order.id }, revert, newQty };
}

/** Undo: restore the quantity, or recreate the deleted listing. */
export function revertAction(
  r: RevertInfo,
):
  | { kind: "update"; orderId: string; platinum: number; quantity: number; visible: boolean }
  | { kind: "create"; itemId: string; platinum: number; quantity: number; visible: boolean; modRank: number | null } {
  return r.newQty > 0
    ? { kind: "update", orderId: r.orderId, platinum: r.platinum, quantity: r.originalQty, visible: r.visible }
    : { kind: "create", itemId: r.itemId, platinum: r.platinum, quantity: r.originalQty, visible: r.visible, modRank: r.modRank ?? null };
}

export const revertHint = (r: RevertInfo) =>
  r.newQty > 0 ? `WFM quantity ${String(r.originalQty)} → ${String(r.newQty)}` : `WFM listing sold (was ×${String(r.originalQty)})`;

export const MAX_CHANGES = 50;
