import { ArrowRight, BarChart3 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useClock, useTopItems, useTrades } from "../../api/statistics";
import {
  byCategory,
  fmtK,
  formatWhen,
  groupSessions,
  inPeriod,
  PERIODS,
  share,
  signed,
  topBought,
  topSold,
  topTraded,
  totals,
  type ItemStat,
  type Period,
  type TradeSession,
} from "../../domain/statistics";
import { ItemImage } from "../../patterns/ItemImage";
import { RankBar } from "../../patterns/RankBar";
import { cn } from "../../primitives/cn";
import { Table, type TableColumn } from "../../primitives/data";
import { Alert, Badge, Card, domainTone, EmptyState, ProgressBar, Spinner } from "../../primitives/display";
import { RadioGroup } from "../../primitives/forms";
import { useMinuteNow } from "../../state/useNow";

/** "180 p", "97.8K p" (narrow no-break space keeps them together). */
const plat = (n: number) => `${fmtK(n)}\u202Fp`;
const tone = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-danger" : "");

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = `panel-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className={cn("min-w-0 flex-1", className)}>
      <Card padding="md" className="flex h-full flex-col gap-3">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {children}
      </Card>
    </section>
  );
}

/** Item name with a ranked bar under it, so shares read beside the figures. */
const nameWithBar = (name: ReactNode, value: number, max: number) => (
  <span className="flex min-w-40 flex-col gap-1">
    <span className="truncate">{name}</span>
    <RankBar share={share(value, max)} />
  </span>
);

function TopItems() {
  const { items, isPending, error, progress } = useTopItems();
  const baseUrl = useImageBaseUrl();
  const list = items ?? [];
  const max = Math.max(0, ...list.map((i) => i.total_value_7d));
  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const columns: Array<TableColumn<(typeof list)[number]>> = [
    {
      id: "item",
      header: "Item",
      cell: (i) =>
        nameWithBar(
          <span className="flex items-center gap-2">
            <ItemImage size="sm" sources={imageSources(i.image_name, baseUrl)} name={i.name} />
            {i.name}
          </span>,
          i.total_value_7d,
          max,
        ),
    },
    { id: "unit", header: "Unit price", align: "end", cell: (i) => <span className="tabular-nums">{plat(i.unit_price)}</span> },
    {
      id: "volume",
      header: "Volume per day",
      align: "end",
      cell: (i) => <span className="tabular-nums">{Math.round(i.daily_volume).toLocaleString("en-US")}</span>,
    },
    {
      id: "total",
      header: "Total value (7 days)",
      align: "end",
      cell: (i) => <span className="font-semibold tabular-nums">{plat(i.total_value_7d)}</span>,
    },
  ];

  return (
    <Panel title="Top warframe.market items (last 7 days)">
      {isPending ? (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <Spinner label="Downloading 7-day statistics from warframe.market…" />
          <p className="text-xs">The first full ranking can take a few minutes; it refreshes every 3 hours.</p>
          {progress && (
            <ProgressBar
              value={progress.completed}
              max={progress.total}
              name="Market ranking progress"
              label={`${String(progress.completed)} / ${String(progress.total)} items`}
              className="max-w-sm"
            />
          )}
        </div>
      ) : error ? (
        <Alert tone="danger" title="Could not load market data.">
          {error.message}
        </Alert>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">No market data available.</p>
      ) : (
        <>
          {progress?.refreshing && (
            <p className="text-xs text-muted">
              Updating from warframe.market: {progress.completed}/{progress.total} items ({pct}%). The previous ranking stays until the scan finishes.
            </p>
          )}
          <Table label="Top warframe.market items" columns={columns} data={list} getRowId={(i) => i.url_name} />
        </>
      )}
    </Panel>
  );
}

function Stat({ label, value, className, highlight = false }: { label: string; value: string; className?: string; highlight?: boolean }) {
  return (
    <Card padding="md" className={cn("flex flex-1 flex-col gap-1", highlight && "border-accent")}>
      <dt className="text-xs text-muted uppercase">{label}</dt>
      <dd className={cn("text-2xl font-semibold tabular-nums", className)}>{value}</dd>
    </Card>
  );
}

function ItemTable({ label, rows, valueClass, emptyText }: { label: string; rows: ItemStat[]; valueClass: string; emptyText: string }) {
  const max = Math.max(0, ...rows.map((r) => r.total_plat));
  const columns: Array<TableColumn<ItemStat>> = [
    { id: "item", header: "Item", cell: (r) => nameWithBar(r.item_name, r.total_plat, max) },
    { id: "qty", header: "Amount", align: "end", cell: (r) => <span className="tabular-nums">{r.quantity.toLocaleString("en-US")}</span> },
    {
      id: "value",
      header: "Total value",
      align: "end",
      cell: (r) => <span className={cn("font-semibold tabular-nums", valueClass)}>{plat(r.total_plat)}</span>,
    },
  ];
  return <Table label={label} columns={columns} data={rows} getRowId={(r) => r.item_name} empty={emptyText} />;
}

const SESSION_BADGE = {
  sale: { label: "Sale", color: "txn-sale" },
  purchase: { label: "Purchase", color: "txn-purchase" },
  trade: { label: "Trade", color: "txn-trade" },
} as const;

function Side({ label, platinum, items }: { label: string; platinum: number; items: TradeSession["givenItems"] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h5 className="text-xs text-muted uppercase">{label}</h5>
      {platinum === 0 && items.length === 0 && <p className="text-sm text-muted">Nothing</p>}
      <ul className="flex flex-col gap-0.5 text-sm">
        {platinum > 0 && <li className="font-semibold tabular-nums">{platinum.toLocaleString("en-US")} platinum</li>}
        {items.map((i, n) => (
          <li key={`${i.name}-${String(n)}`}>
            {i.qty > 1 && <span className="text-muted tabular-nums">{i.qty}× </span>}
            {i.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionCard({ session, when }: { session: TradeSession; when: string }) {
  const badge = SESSION_BADGE[session.tradeType];
  return (
    <li>
      <Card as="article" padding="sm" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center gap-2">
          <Badge tone="domain" style={domainTone(badge.color)}>
            {badge.label}
          </Badge>
          {session.withPlayer && <h4 className="text-sm font-semibold">{session.withPlayer}</h4>}
          <time className="ms-auto text-xs text-muted" dateTime={session.timestamp}>
            {when}
          </time>
        </header>
        <div className="flex items-start gap-3">
          <Side label="Gave" platinum={session.givenPlat} items={session.givenItems} />
          <ArrowRight aria-hidden="true" className="mt-5 size-4 shrink-0 text-muted" />
          <Side label="Received" platinum={session.receivedPlat} items={session.receivedItems} />
        </div>
      </Card>
    </li>
  );
}

/** Trade history: totals, categories, top items, and the per-trade log. */
export function TradeReport() {
  const trades = useTrades();
  const { clock, locale } = useClock();
  const [view, setView] = useState<"analytics" | "log">("analytics");
  const [period, setPeriod] = useState<Period>(30);
  const all = trades.data;
  // Whole minutes are precise enough for a period of days, and avoid recomputing every second.
  const minute = Math.floor(useMinuteNow() / 60_000);
  const rows = useMemo(() => inPeriod(all ?? [], period, minute * 60_000), [all, period, minute]);
  const sum = useMemo(() => totals(rows), [rows]);
  const categories = useMemo(() => byCategory(rows), [rows]);
  const traded = useMemo(() => topTraded(rows), [rows]);
  const maxProfit = Math.max(0, ...categories.map((c) => c.profit));
  const maxTraded = Math.max(0, ...traded.map((t) => t.total_plat));

  const categoryColumns: Array<TableColumn<(typeof categories)[number]>> = [
    { id: "type", header: "Type", cell: (c) => nameWithBar(c.category, c.profit, maxProfit) },
    { id: "revenue", header: "Revenue", align: "end", cell: (c) => <span className="tabular-nums">{c.revenue > 0 ? plat(c.revenue) : "–"}</span> },
    {
      id: "expenses",
      header: "Expenses",
      align: "end",
      cell: (c) => <span className="tabular-nums">{c.expenses > 0 ? plat(c.expenses) : "–"}</span>,
    },
    {
      id: "profit",
      header: "Profit",
      align: "end",
      cell: (c) => <span className={cn("font-semibold tabular-nums", tone(c.profit))}>{`${signed(c.profit)}\u202Fp`}</span>,
    },
  ];
  const tradedColumns: Array<TableColumn<ItemStat>> = [
    { id: "item", header: "Item", cell: (t) => nameWithBar(t.item_name, t.total_plat, maxTraded) },
    {
      id: "value",
      header: "Total value",
      align: "end",
      cell: (t) => <span className="tabular-nums">{t.total_plat > 0 ? plat(t.total_plat) : `${t.quantity.toLocaleString("en-US")}×`}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <TopItems />

      <div className="flex flex-wrap items-center gap-3">
        <RadioGroup
          legend="View"
          hideLegend
          appearance="segmented"
          value={view}
          onValueChange={setView}
          options={[
            { value: "analytics", label: "Analytics" },
            { value: "log", label: "Log" },
          ]}
        />
        <RadioGroup
          legend="Period"
          hideLegend
          appearance="segmented"
          value={String(period)}
          onValueChange={(v) => {
            setPeriod(v === "all" ? "all" : (Number(v) as Period));
          }}
          options={PERIODS.map((p) => ({ value: String(p.value), label: p.label }))}
        />
        <p aria-live="polite" className="text-sm text-muted tabular-nums">
          {rows.length} trade{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {trades.isPending ? (
        <Spinner label="Loading trades…" />
      ) : trades.isError ? (
        <Alert tone="danger" title="Could not load trades.">
          {trades.error.message}
        </Alert>
      ) : (all ?? []).length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No trade history yet."
          description="Trades are recorded automatically from in-game trade sessions. Finish a trade and it shows up here."
        />
      ) : view === "log" ? (
        rows.length === 0 ? (
          <EmptyState title="No trades in this period." />
        ) : (
          <ul aria-label="Trade log" className="flex flex-col gap-2">
            {groupSessions(rows).map((s) => (
              <SessionCard key={s.sessionId} session={s} when={formatWhen(s.timestamp, locale, clock)} />
            ))}
          </ul>
        )
      ) : (
        <>
          <dl className="flex flex-wrap gap-3">
            <Stat label="Total revenue" value={plat(sum.revenue)} />
            <Stat label="Total expenses" value={plat(sum.expenses)} />
            <Stat label="Profit" value={`${signed(sum.profit)}\u202Fp`} className={tone(sum.profit)} highlight />
          </dl>
          <div className="flex flex-wrap gap-3">
            <Panel title="Top traded items">
              <Table label="Top traded items" columns={tradedColumns} data={traded} getRowId={(t) => t.item_name} empty="No trades in this period." />
            </Panel>
            <Panel title="By type">
              <Table
                label="Trades by type"
                columns={categoryColumns}
                data={categories}
                getRowId={(c) => c.category}
                empty="No trades in this period."
              />
            </Panel>
          </div>
          <div className="flex flex-wrap gap-3">
            <Panel title="Sales">
              <ItemTable label="Sales" rows={topSold(rows)} valueClass="text-success" emptyText="No sales recorded." />
            </Panel>
            <Panel title="Purchases">
              <ItemTable label="Purchases" rows={topBought(rows)} valueClass="" emptyText="No purchases recorded." />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
