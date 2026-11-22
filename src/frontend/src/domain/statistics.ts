/**
 * Statistics: trade report and tracked item quantities.
 */

export type Trade = {
  id: number;
  timestamp: string;
  with_player: string;
  direction: "sold" | "bought" | "traded-out" | "traded-in";
  item_name: string;
  item_url: string;
  quantity: number;
  platinum: number;
  source: string;
  notes: string;
  session_id: string;
  trade_type: string;
};

export type TopItem = { name: string; url_name: string; image_name?: string; unit_price: number; daily_volume: number; total_value_7d: number };
export type TopProgress = { completed: number; total: number; refreshing: boolean };
export type TrackedItem = { unique_name: string; display_name: string; added_at: string };
export type SnapshotPoint = { date: string; quantity: number; change: number };

// ── Trades ──────────────────────────────────────────────────────────────────

export type Period = 7 | 30 | 90 | "all";
export const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: "all", label: "All" },
];

/** Rank stars are private-use characters: "Serration" + 3 stars → "Serration (R3)". */
export function displayItemName(name: string): string {
  const rank = name.match(/[\uE000-\uF8FF]/gu)?.length ?? 0;
  const clean = name.replace(/[\uE000-\uF8FF\p{Cc}]/gu, "").trim();
  return rank > 0 ? `${clean} (R${String(rank)})` : clean;
}

export const inPeriod = (trades: readonly Trade[], period: Period, now: number) =>
  period === "all" ? [...trades] : trades.filter((t) => new Date(t.timestamp).getTime() >= now - period * 86_400_000);

const isOut = (t: Trade) => t.direction === "sold" || t.direction === "traded-out";
const value = (t: Trade) => t.platinum * t.quantity;

export function totals(trades: readonly Trade[]): { revenue: number; expenses: number; profit: number } {
  const revenue = trades.filter(isOut).reduce((s, t) => s + value(t), 0);
  const expenses = trades.filter((t) => !isOut(t)).reduce((s, t) => s + value(t), 0);
  return { revenue, expenses, profit: revenue - expenses };
}

export const CATEGORIES = ["Prime", "Riven", "Set", "Arcane", "Mod", "Relic", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export function inferCategory(name: string): Category {
  const n = name.toLowerCase();
  if (n.includes("riven")) return "Riven";
  if (n.includes("arcane")) return "Arcane";
  if (n.includes("relic")) return "Relic";
  if (n.includes("prime")) return "Prime";
  if (/ set$/.test(n)) return "Set";
  if (/\bmod\b/.test(n)) return "Mod";
  return "Other";
}

export type CategoryStat = { category: Category; revenue: number; expenses: number; profit: number };

/** Per category, most profit first. */
export function byCategory(trades: readonly Trade[]): CategoryStat[] {
  const map = new Map<Category, { revenue: number; expenses: number }>();
  for (const t of trades) {
    const c = inferCategory(t.item_name);
    const cur = map.get(c) ?? { revenue: 0, expenses: 0 };
    if (isOut(t)) cur.revenue += value(t);
    else cur.expenses += value(t);
    map.set(c, cur);
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v, profit: v.revenue - v.expenses })).sort((a, b) => b.profit - a.profit);
}

export type ItemStat = { item_name: string; quantity: number; total_plat: number };

function aggregate(trades: readonly Trade[]): ItemStat[] {
  const map = new Map<string, ItemStat>();
  for (const t of trades) {
    const cur = map.get(t.item_name) ?? { item_name: t.item_name, quantity: 0, total_plat: 0 };
    cur.quantity += t.quantity;
    cur.total_plat += value(t);
    map.set(t.item_name, cur);
  }
  return [...map.values()];
}

export const TOP_N = 7;
export const topSold = (trades: readonly Trade[]) =>
  aggregate(trades.filter(isOut))
    .sort((a, b) => b.total_plat - a.total_plat)
    .slice(0, TOP_N);
export const topBought = (trades: readonly Trade[]) =>
  aggregate(trades.filter((t) => !isOut(t)))
    .sort((a, b) => b.total_plat - a.total_plat)
    .slice(0, TOP_N);
/** Most traded by value, then by quantity (trades without platinum still count). */
export const topTraded = (trades: readonly Trade[]) =>
  aggregate(trades)
    .sort((a, b) => b.total_plat - a.total_plat || b.quantity - a.quantity)
    .slice(0, TOP_N);

export type TradeSession = {
  sessionId: string;
  withPlayer: string;
  tradeType: "sale" | "purchase" | "trade";
  givenItems: Array<{ name: string; qty: number }>;
  givenPlat: number;
  receivedItems: Array<{ name: string; qty: number }>;
  receivedPlat: number;
  timestamp: string;
};

/** One card per in-game trade; old rows without a session are their own session. Newest first. */
export function groupSessions(trades: readonly Trade[]): TradeSession[] {
  const bySession = new Map<string, Trade[]>();
  const sessions: TradeSession[] = [];
  for (const t of trades) {
    if (t.session_id) bySession.set(t.session_id, [...(bySession.get(t.session_id) ?? []), t]);
    else {
      const sold = t.direction === "sold";
      sessions.push({
        sessionId: String(t.id),
        withPlayer: t.with_player,
        tradeType: t.direction === "bought" ? "purchase" : "sale",
        givenItems: sold ? [{ name: t.item_name, qty: t.quantity }] : [],
        givenPlat: t.direction === "bought" ? t.platinum : 0,
        receivedItems: t.direction === "bought" ? [{ name: t.item_name, qty: t.quantity }] : [],
        receivedPlat: sold ? t.platinum : 0,
        timestamp: t.timestamp,
      });
    }
  }
  for (const [sessionId, rows] of bySession) {
    const first = rows[0];
    if (!first) continue;
    sessions.push({
      sessionId,
      withPlayer: first.with_player,
      tradeType: first.trade_type === "purchase" ? "purchase" : first.trade_type === "trade" ? "trade" : "sale",
      givenItems: rows.filter((r) => r.direction === "sold" || r.direction === "traded-out").map((r) => ({ name: r.item_name, qty: r.quantity })),
      receivedItems: rows.filter((r) => r.direction === "bought" || r.direction === "traded-in").map((r) => ({ name: r.item_name, qty: r.quantity })),
      receivedPlat: rows.filter((r) => r.direction === "sold").reduce((s, r) => s + r.platinum, 0),
      givenPlat: rows.filter((r) => r.direction === "bought").reduce((s, r) => s + r.platinum, 0),
      timestamp: first.timestamp,
    });
  }
  return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/** "12,450" below 10 000, "12.5K" above. */
export const fmtK = (n: number) => (Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US"));
export const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmtK(n)}`;

/** Bar length relative to the largest value in the list (0–1). */
export const share = (value: number, max: number) => (max > 0 ? Math.max(0, value) / max : 0);

export type ClockFormat = "auto" | "12h" | "24h";
export const clockFormatFrom = (v: unknown): ClockFormat => (v === "12h" || v === "24h" ? v : "auto");

export function formatWhen(iso: string, locale: string, clock: ClockFormat): string {
  const date = new Date(iso);
  const time: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", ...(clock === "auto" ? {} : { hour12: clock === "12h" }) };
  return `${date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })} ${date.toLocaleTimeString(locale, time)}`;
}

// ── Item report ─────────────────────────────────────────────────────────────

export type Timeframe = 7 | 30 | 90 | "all";

/** Snapshots within the timeframe (dates are YYYY-MM-DD, compared as text). */
export function snapshotsIn(points: readonly SnapshotPoint[], tf: Timeframe, today: Date): SnapshotPoint[] {
  if (tf === "all") return [...points];
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - tf);
  const cut = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= cut);
}

/** Current, average change per day and total change (from the second point on). */
export function snapshotStats(points: readonly SnapshotPoint[]): { current: number | null; avgPerDay: number | null; total: number | null } {
  const last = points[points.length - 1];
  if (!last) return { current: null, avgPerDay: null, total: null };
  if (points.length < 2) return { current: last.quantity, avgPerDay: null, total: null };
  const total = points.slice(1).reduce((s, p) => s + p.change, 0);
  // `|| 0` turns a rounded -0 into 0.
  return { current: last.quantity, avgPerDay: Math.round(total / (points.length - 1)) || 0, total };
}

/** Up to 20 untracked catalogue items: exact match, then starts-with, then A–Z. */
export function trackCandidates<T extends { unique_name: string; name: string }>(
  catalog: readonly T[],
  tracked: ReadonlySet<string>,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (n: string) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
  return catalog
    .filter((c) => !tracked.has(c.unique_name) && c.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a.name.toLowerCase()) - rank(b.name.toLowerCase()) || a.name.localeCompare(b.name))
    .slice(0, 20);
}

/** Saved order first; new items keep their backend order at the end. */
export function orderTracked(items: readonly TrackedItem[], order: readonly string[]): TrackedItem[] {
  const pos = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...items].sort((a, b) => pos(a.unique_name) - pos(b.unique_name));
}

/** Moves one item up or down; returns the full new order. */
export function moveTracked(items: readonly TrackedItem[], order: readonly string[], id: string, direction: -1 | 1): string[] {
  const ids = orderTracked(items, order).map((t) => t.unique_name);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
