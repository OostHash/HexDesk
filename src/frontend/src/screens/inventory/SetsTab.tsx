import { CircleCheck, Copy as CopyIcon, Hammer, PackageOpen } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useRecipes } from "../../api/foundry";
import { useCrafting, useOwnership } from "../../api/inventory";
import { prioritisePrice, useCatalogList, useLivePrices, useQueuePrices, useWfmItems, useWfmLookup } from "../../api/market";
import { useFilterPresets } from "../../api/presets";
import {
  buildSets,
  DEFAULT_MARKET_FILTERS,
  ducatTotals,
  marketPresetCodec,
  queueOrder,
  requiredCounts,
  setParts,
  toggleIn,
  visibleSets,
  type MarketFilters,
  type PrimeSet,
  type SetContext,
  type SetSummary,
} from "../../domain/market";
import { ItemImage } from "../../patterns/ItemImage";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls } from "../../patterns/ViewControls";
import { pageAfterResize, usePage, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { PresetBar } from "../../patterns/PresetBar";
import { Pagination } from "../../primitives/navigation";
import { cn } from "../../primitives/cn";
import { Badge, Card, Chip, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { DucatBadge, fmt, PlatBadge } from "../../patterns/MarketBadges";
import type { MarketTarget } from "../../domain/market";

const SORT_LABEL: Readonly<Record<MarketFilters["sortMode"], string>> = {
  plat: "Most platinum",
  ducats: "Most ducats",
  az: "Name, A–Z",
  za: "Name, Z–A",
};

const EMPTY_RECIPES = new Map();

type Props = {
  filters: MarketFilters;
  setFilters: (f: MarketFilters) => void;
  onOpen: (target: MarketTarget) => void;
};

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {children}
    </div>
  );
}

function SetCard({
  set,
  summary,
  ctx,
  building,
  baseUrl,
  onOpen,
}: {
  set: PrimeSet;
  summary: SetSummary;
  ctx: SetContext;
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
            </span>
          </div>
          {summary.price !== null ? (
            <PlatBadge value={summary.price} suffix="set" />
          ) : (
            <span className="text-xs text-muted">{ctx.prices.size > 0 ? "No price" : "…"}</span>
          )}
        </header>
        <ul aria-label={`Parts of ${set.name}`} className="flex flex-col divide-y divide-border/60 border-t border-border text-xs">
          {parts.map((p) => (
            <li key={p.item.unique_name}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  onOpen({ slug: p.slug, name: p.item.name, imageName: p.item.image_name ?? null, rank: null });
                }}
                className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-sm px-1 py-1 text-start hover:bg-hover"
              >
                <span className={cn("truncate", p.qty === 0 && "text-muted")}>{p.label}</span>
                <span className="text-muted tabular-nums">{p.item.ducats ?? "—"} ducats</span>
                <span className="w-10 text-end tabular-nums">{p.price !== null ? `${fmt(p.price)}p` : "—"}</span>
                <Badge tone={p.qty === 0 ? "neutral" : p.qty > p.required ? "warning" : "success"} variant={p.qty === 0 ? "outline" : "soft"}>
                  {p.qty}
                  <span className="sr-only"> owned</span>
                </Badge>
              </button>
            </li>
          ))}
        </ul>
        {summary.ducats > 0 && (
          <p className="mt-auto text-xs text-muted">
            <span className="tabular-nums">{fmt(summary.ducats)}</span> ducats in owned parts
          </p>
        )}
      </Card>
    </li>
  );
}

/** Prime sets: completion, duplicates and prices per set and part. */
export function SetsTab({ filters, setFilters, onOpen }: Props) {
  const catalog = useCatalogList();
  const { ownership: own } = useOwnership();
  const crafting = useCrafting();
  const wfmItems = useWfmItems();
  const lookup = useWfmLookup();
  const { prices } = useLivePrices();
  const baseUrl = useImageBaseUrl();

  const sets = useMemo(() => buildSets(catalog.data ?? []), [catalog.data]);
  const parentIds = useMemo(() => sets.flatMap((s) => (s.parent ? [s.parent.unique_name] : [])), [sets]);
  const recipes = useRecipes(parentIds) ?? EMPTY_RECIPES;
  const required = useMemo(() => requiredCounts(recipes.values()), [recipes]);
  const ctx: SetContext = useMemo(() => ({ own, required, lookup, prices }), [own, required, lookup, prices]);

  // Re-queues only when the slug order changes (useQueuePrices compares the joined list).
  const queue = useMemo(() => (lookup.size > 0 ? queueOrder(sets, { own, lookup }) : []), [sets, lookup, own]);
  useQueuePrices(queue);

  const rows = useMemo(() => visibleSets(sets, filters, ctx), [sets, filters, ctx]);
  const [pageSize, setPageSize] = usePageSize("sets");
  const [cardScale, setCardScale] = useCardScale("sets");
  const [showImages, setShowImages] = useShowImages("sets");
  const pager = usePage(rows.length, pageSize, filters);
  const scroller = useScrollTopOn(pager.page);
  const totals = useMemo(() => ducatTotals(sets, ctx), [sets, ctx]);
  const codec = useMemo(() => marketPresetCodec(filters.activeMarketTab), [filters.activeMarketTab]);
  const presets = useFilterPresets(codec, filters, setFilters, { ...DEFAULT_MARKET_FILTERS, activeMarketTab: filters.activeMarketTab });
  const set = (patch: Partial<MarketFilters>) => {
    setFilters({ ...filters, ...patch });
  };
  const building = (s: PrimeSet) =>
    crafting.some((c) => c.unique_name === s.parent?.unique_name || s.parts.some((p) => p.unique_name === c.unique_name));
  const open = (t: MarketTarget) => {
    prioritisePrice(t.slug);
    onOpen(t);
  };

  return (
    <ItemImagesContext value={showImages}>
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
            <ChipGroup label="Built item">
              <Chip
                active={filters.ownership.includes("owned")}
                onActiveChange={() => {
                  set({ ownership: toggleIn(filters.ownership, "owned") });
                }}
              >
                Owned
              </Chip>
              <Chip
                active={filters.ownership.includes("notowned")}
                onActiveChange={() => {
                  set({ ownership: toggleIn(filters.ownership, "notowned") });
                }}
              >
                Not owned
              </Chip>
            </ChipGroup>
            <ChipGroup label="Parts (any of)">
              <Chip
                active={filters.conditions.includes("dupes")}
                onActiveChange={() => {
                  set({ conditions: toggleIn(filters.conditions, "dupes") });
                }}
              >
                Dupes
              </Chip>
              <Chip
                active={filters.conditions.includes("itemowned")}
                onActiveChange={() => {
                  set({ conditions: toggleIn(filters.conditions, "itemowned") });
                }}
              >
                Item owned
              </Chip>
              <Chip
                active={filters.conditions.includes("fullset")}
                onActiveChange={() => {
                  set({ conditions: toggleIn(filters.conditions, "fullset") });
                }}
              >
                Full set
              </Chip>
              <Chip
                active={filters.conditions.includes("hasparts")}
                onActiveChange={() => {
                  set({ conditions: toggleIn(filters.conditions, "hasparts") });
                }}
              >
                Has parts
              </Chip>
            </ChipGroup>
            <ChipGroup label="Vault">
              <Chip
                active={filters.vault.includes("vaulted")}
                onActiveChange={() => {
                  set({ vault: toggleIn(filters.vault, "vaulted") });
                }}
              >
                Vaulted
              </Chip>
              <Chip
                active={filters.vault.includes("unvaulted")}
                onActiveChange={() => {
                  set({ vault: toggleIn(filters.vault, "unvaulted") });
                }}
              >
                Unvaulted
              </Chip>
            </ChipGroup>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PresetBar model={presets} label="Market" />
            <label className="flex items-center gap-2 text-xs text-muted">
              Sort
              <Select
                size="sm"
                value={filters.sortMode}
                onChange={(e) => {
                  set({ sortMode: e.target.value as MarketFilters["sortMode"] });
                }}
                className="w-44"
              >
                {(Object.keys(SORT_LABEL) as Array<MarketFilters["sortMode"]>).map((m) => (
                  <option key={m} value={m}>
                    {SORT_LABEL[m]}
                  </option>
                ))}
              </Select>
            </label>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <DucatBadge value={totals.total} /> in owned parts
              <DucatBadge value={totals.dupes} /> from dupes
              <span>
                {wfmItems.data
                  ? `· ${fmt(wfmItems.data.length)} items from warframe.market`
                  : wfmItems.isError
                    ? "· warframe.market unavailable"
                    : "· Connecting to warframe.market…"}
              </span>
            </p>
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
            summary={`${fmt(rows.length)} set${rows.length === 1 ? "" : "s"}`}
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
            <EmptyState icon={PackageOpen} title="No sets match." description="Change the filters, or own some prime parts first." />
          ) : (
            <ul className={CARD_GRID} style={cardGridStyle(17, cardScale)}>
              {rows.slice(pager.start, pager.end).map(({ set: s, summary }) => (
                <SetCard key={s.name} set={s} summary={summary} ctx={ctx} building={building(s)} baseUrl={baseUrl} onOpen={open} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ItemImagesContext>
  );
}
