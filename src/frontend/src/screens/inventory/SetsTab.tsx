import { Archive, CircleCheck, Copy as CopyIcon, Hammer, PackageOpen } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useRecipes, useRelicDrops, useRelicNames } from "../../api/foundry";
import { useCrafting, useOwnership } from "../../api/inventory";
import { prioritisePrice, useCatalogList, useLivePrices, useQueuePrices, useWfmLookup } from "../../api/market";
import { useSettings } from "../../api/settings";
import { ownedRelicsFor } from "../../domain/foundry";
import { sellFromSetting } from "../../domain/inventory";
import {
  buildSets,
  DEFAULT_SET_FILTERS,
  ducatTotals,
  queueOrder,
  requiredCounts,
  SET_GROUPS,
  setGroupCounts,
  setParts,
  visibleSets,
  type PrimeSet,
  type SetContext,
  type SetFilters,
  type SetSummary,
  type SetValue,
} from "../../domain/market";
import { ItemImage } from "../../patterns/ItemImage";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls } from "../../patterns/ViewControls";
import { pageAfterResize, usePage, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { Pagination, SidebarItem } from "../../primitives/navigation";
import { cn } from "../../primitives/cn";
import { Badge, Card, Chip, domainTone, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { DucatBadge, fmt } from "../../patterns/MarketBadges";
import type { MarketTarget } from "../../domain/market";
import { SetFiltersPopover } from "./SetFiltersPopover";

const SORT_LABEL: Readonly<Record<SetFilters["sort"], string>> = {
  value: "Most platinum",
  plat: "Highest set price",
  ducats: "Most ducats",
  az: "Name, A–Z",
  za: "Name, Z–A",
};

const EMPTY_RECIPES = new Map();

type RelicLookup = {
  drops: Readonly<Record<string, readonly string[]>>;
  names: ReadonlyMap<string, string>;
};

function ValueCell({ label, best, children }: { label: string; best: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-faint">{label}</dt>
      <dd className={cn("flex items-center gap-1 tabular-nums", best ? "font-semibold text-success" : "text-text")}>
        {children}
        {best && (
          <>
            <CircleCheck aria-hidden="true" className="size-3" />
            <span className="sr-only">, best</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The set price, and what one set's worth of owned parts fetches as parts and
 * in ducats once you own any.
 */
function SetValueLine({ value, complete, loading, name }: { value: SetValue; complete: boolean; loading: boolean; name: string }) {
  const plat = (n: number | null, missing: string) => (n === null ? <span title={missing}>{loading ? "…" : "—"}</span> : `${fmt(n)}p`);
  return (
    <dl aria-label={`Selling ${name}`} className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-2 text-xs">
      <ValueCell label="As set" best={value.best === "set"}>
        {plat(value.set, "No market price for the set")}
      </ValueCell>
      {value.ducats > 0 && (
        <>
          <ValueCell label={complete ? "As parts" : "Owned parts"} best={value.best === "parts"}>
            {plat(value.parts, "Not every part has a market price")}
          </ValueCell>
          <ValueCell label="Ducats" best={false}>
            {fmt(value.ducats)}
          </ValueCell>
        </>
      )}
    </dl>
  );
}

/** A part's ducats; marked when trading it for ducats beats selling it. */
/**
 * A part's ducats or price, marked when it is the better way to get rid of a
 * copy. Marked and plain values take the same box, so the columns stay put.
 */
function TradeCell({
  value,
  unit,
  tone,
  marked,
  title,
}: {
  value: number | null;
  unit: "ducats" | "platinum";
  tone: "ducat" | "price-platinum";
  marked: boolean;
  title: string | undefined;
}) {
  if (value === null) return <span className="justify-self-end px-1.5 text-faint">—</span>;
  return (
    <span
      title={title}
      className={cn("justify-self-end rounded-sm px-1.5 py-px text-tone tabular-nums", marked && "bg-(--hex-tone)/15 font-medium")}
      style={domainTone(tone)}
    >
      {unit === "platinum" ? `${fmt(value)}p` : fmt(value)}
      <span className="sr-only">
        {unit === "ducats" ? " ducats" : ""}
        {marked ? (unit === "ducats" ? ", better for ducats than selling" : ", better to sell") : ""}
      </span>
    </span>
  );
}

const tradeTitle = (ducats: number | null, price: number | null, sellFrom: number | null, better: "ducats" | "plat" | null) =>
  ducats === null || price === null || sellFrom === null
    ? undefined
    : `${fmt(ducats)} ducats for ${fmt(price)}p, sell from ${fmt(sellFrom)}p: ${better === "ducats" ? "better for ducats" : "better to sell"}`;

function SetCard({
  set,
  summary,
  value,
  ctx,
  relics,
  building,
  baseUrl,
  onOpen,
}: {
  set: PrimeSet;
  summary: SetSummary;
  value: SetValue;
  ctx: SetContext;
  relics: RelicLookup;
  building: boolean;
  baseUrl: string | undefined;
  onOpen: (t: MarketTarget) => void;
}) {
  const parts = setParts(set, ctx);
  const image = set.parent?.image_name ?? set.parts[0]?.image_name ?? null;
  return (
    <li>
      <Card as="article" padding="sm" interactive className={cn("flex h-full flex-col gap-2", summary.complete && "border-success/60")}>
        <header className="flex items-start gap-2">
          <ItemImage sources={imageSources(image ?? undefined, baseUrl)} name={set.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="flex min-w-0 text-sm">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  onOpen({ slug: summary.slug, name: `${set.name} Set`, imageName: image, rank: null });
                }}
                className="truncate rounded-sm text-start font-semibold hover:text-accent hover:underline"
              >
                {set.name}
                <span className="sr-only"> — show set orders</span>
              </button>
            </h3>
            <span className="flex flex-wrap gap-1">
              {summary.complete ? (
                <Badge tone="success" icon={CircleCheck}>
                  Complete
                </Badge>
              ) : (
                <Badge>
                  {summary.owned} of {set.parts.length} parts
                </Badge>
              )}
              {summary.dupes && (
                <Badge tone="warning" icon={CopyIcon}>
                  Dupes
                </Badge>
              )}
              {building && (
                <Badge tone="info" icon={Hammer}>
                  Building
                </Badge>
              )}
              {summary.vaulted && <Badge icon={Archive}>Vaulted</Badge>}
            </span>
          </div>
        </header>
        <ul aria-label={`Parts of ${set.name}`} className="flex flex-col divide-y divide-border/60 border-t border-border text-xs">
          {parts.map((p) => {
            const relicNames = p.qty === 0 ? ownedRelicsFor(p.item.unique_name, relics.drops, relics.names, ctx.own) : [];
            return (
              <li key={p.item.unique_name}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => {
                    onOpen({ slug: p.slug, name: p.item.name, imageName: p.item.image_name ?? null, rank: null });
                  }}
                  className="grid w-full grid-cols-[minmax(0,1fr)_3rem_2.5rem_1.75rem] items-center gap-2 rounded-sm px-1 py-1 text-start hover:bg-hover"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("truncate", p.qty === 0 && "text-muted")}>{p.label}</span>
                    {relicNames.length > 0 && (
                      <Badge size="sm" tone="domain" style={domainTone("relic-highlight")} title={relicNames.join("\n")}>
                        {relicNames.length === 1 ? "1 relic" : `${String(relicNames.length)} relics`}
                        <span className="sr-only"> you own drop it: {relicNames.join(", ")}</span>
                      </Badge>
                    )}
                  </span>
                  <TradeCell
                    value={p.item.ducats ?? null}
                    unit="ducats"
                    tone="ducat"
                    marked={p.better === "ducats"}
                    title={tradeTitle(p.item.ducats ?? null, p.price, p.sellFrom, p.better)}
                  />
                  <TradeCell
                    value={p.price}
                    unit="platinum"
                    tone="price-platinum"
                    marked={p.better === "plat"}
                    title={tradeTitle(p.item.ducats ?? null, p.price, p.sellFrom, p.better)}
                  />
                  {p.qty === 0 ? (
                    <span className="justify-self-center text-faint">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">none owned</span>
                    </span>
                  ) : (
                    <Badge tone={p.qty > p.required ? "warning" : "success"} className="justify-self-center">
                      {p.qty}
                      <span className="sr-only"> owned</span>
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <SetValueLine value={value} complete={summary.complete} loading={ctx.prices.size === 0} name={set.name} />
      </Card>
    </li>
  );
}

/** Prime sets: completion, duplicates and what selling them is worth. Filters are local. */
export function SetsTab({ onOpen }: { onOpen: (target: MarketTarget) => void }) {
  const catalog = useCatalogList();
  const { ownership: own } = useOwnership();
  const crafting = useCrafting();
  const lookup = useWfmLookup();
  const { prices } = useLivePrices();
  const baseUrl = useImageBaseUrl();
  const relicDrops = useRelicDrops();
  const relicNames = useRelicNames();
  const relics: RelicLookup = useMemo(() => ({ drops: relicDrops, names: relicNames }), [relicDrops, relicNames]);
  const [filters, setFilters] = useState<SetFilters>(DEFAULT_SET_FILTERS);

  const sets = useMemo(() => buildSets(catalog.data ?? []), [catalog.data]);
  const parentIds = useMemo(() => sets.flatMap((s) => (s.parent ? [s.parent.unique_name] : [])), [sets]);
  const recipes = useRecipes(parentIds) ?? EMPTY_RECIPES;
  const required = useMemo(() => requiredCounts(recipes.values()), [recipes]);
  const { data: settings } = useSettings();
  const storedSellFrom = settings?.sellFrom;
  const sellFrom = useMemo(() => sellFromSetting(storedSellFrom), [storedSellFrom]);
  const ctx: SetContext = useMemo(() => ({ own, sellFrom, required, lookup, prices }), [own, sellFrom, required, lookup, prices]);

  // Re-queues only when the slug order changes (useQueuePrices compares the joined list).
  const queue = useMemo(() => (lookup.size > 0 ? queueOrder(sets, { own, lookup }) : []), [sets, lookup, own]);
  useQueuePrices(queue);

  const rows = useMemo(() => visibleSets(sets, filters, ctx), [sets, filters, ctx]);
  const counts = useMemo(() => setGroupCounts(sets, own), [sets, own]);
  const [pageSize, setPageSize] = usePageSize("sets");
  const [cardScale, setCardScale] = useCardScale("sets");
  const [showImages, setShowImages] = useShowImages("sets");
  const pager = usePage(rows.length, pageSize, filters);
  const scroller = useScrollTopOn(pager.page);
  const totals = useMemo(() => ducatTotals(sets, ctx), [sets, ctx]);
  const set = (patch: Partial<SetFilters>) => {
    setFilters({ ...filters, ...patch });
  };
  const building = (s: PrimeSet) =>
    crafting.some((c) => c.unique_name === s.parent?.unique_name || s.parts.some((p) => p.unique_name === c.unique_name));
  const open = (t: MarketTarget) => {
    prioritisePrice(t.slug);
    onOpen(t);
  };
  const withParts = counts.withParts[filters.group] ?? 0;
  const total = counts.total[filters.group] ?? 0;

  return (
    <ItemImagesContext value={showImages}>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Prime set categories" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2">
          <ul className="flex flex-col gap-0.5">
            {SET_GROUPS.map((g) => {
              const owned = counts.withParts[g.id] ?? 0;
              const all = counts.total[g.id] ?? 0;
              return (
                <li key={g.id}>
                  <SidebarItem
                    active={filters.group === g.id}
                    label={g.label}
                    badge={<span className="text-xs text-muted tabular-nums">{owned > 0 ? `${fmt(owned)} / ${fmt(all)}` : fmt(all)}</span>}
                    onClick={() => {
                      set({ group: g.id });
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <dl aria-label="Ducats" className="mt-auto flex flex-col gap-1 border-t border-border px-3 pt-3 pb-1 text-xs text-muted">
            <div className="flex items-center justify-between gap-2">
              <dt>In owned parts</dt>
              <dd>
                <DucatBadge value={totals.total} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>From dupes</dt>
              <dd>
                <DucatBadge value={totals.dupes} />
              </dd>
            </div>
          </dl>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg px-4 py-3 lg:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <SearchInput
                label="Search sets"
                placeholder="Search sets (comma-separated)…"
                value={filters.search}
                onValueChange={(search) => {
                  set({ search });
                }}
                size="sm"
                className="w-64"
              />
              <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
                <Chip
                  active={filters.hasParts}
                  onActiveChange={(hasParts) => {
                    set({ hasParts });
                  }}
                >
                  Has parts
                </Chip>
                <Chip
                  active={filters.complete}
                  onActiveChange={(complete) => {
                    set({ complete });
                  }}
                >
                  Complete
                </Chip>
                <Chip
                  active={filters.dupes}
                  onActiveChange={(dupes) => {
                    set({ dupes });
                  }}
                >
                  Dupes
                </Chip>
              </div>
              <SetFiltersPopover filters={filters} onChange={set} />
              <label className="flex items-center gap-2 text-xs text-muted">
                Sort
                <Select
                  size="sm"
                  value={filters.sort}
                  onChange={(e) => {
                    set({ sort: e.target.value as SetFilters["sort"] });
                  }}
                  className="w-40"
                >
                  {(Object.keys(SORT_LABEL) as Array<SetFilters["sort"]>).map((m) => (
                    <option key={m} value={m}>
                      {SORT_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </label>
              <ViewControls
                screen="sets"
                scale={cardScale}
                onScaleChange={setCardScale}
                pageSize={pageSize}
                onPageSizeChange={(next) => {
                  pager.setPage(pageAfterResize(pager.page, pageSize, next));
                  setPageSize(next);
                }}
                images={showImages}
                onImagesChange={setShowImages}
              />
            </div>
            <Pagination
              page={pager.page}
              pageCount={pager.pageCount}
              onPageChange={pager.setPage}
              summary={`${fmt(withParts)} with parts · ${fmt(total)} total · ${fmt(rows.length)} shown`}
              compact
            />
          </div>

          <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-6">
            {catalog.isPending ? (
              <ul aria-busy="true" className={CARD_GRID} style={cardGridStyle(17, cardScale)}>
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i}>
                    <Card padding="sm">
                      <Skeleton lines={6} />
                    </Card>
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              <EmptyState icon={PackageOpen} title="No sets match." description="Change the search or the filters, or own some prime parts first." />
            ) : (
              <ul className={CARD_GRID} style={cardGridStyle(17, cardScale)}>
                {rows.slice(pager.start, pager.end).map(({ set: s, summary, value }) => (
                  <SetCard
                    key={s.name}
                    set={s}
                    summary={summary}
                    value={value}
                    ctx={ctx}
                    relics={relics}
                    building={building(s)}
                    baseUrl={baseUrl}
                    onOpen={open}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ItemImagesContext>
  );
}
