import { Archive, CircleCheck, Copy as CopyIcon, Hammer, PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useCrafting } from "../../api/inventory";
import { useQueuePrices } from "../../api/market";
import {
  DEFAULT_SET_FILTERS,
  ducatTotals,
  queueOrder,
  SET_GROUPS,
  setGroupCounts,
  visibleSets,
  type PrimeSet,
  type SetContext,
  type SetFilters,
  type SetSummary,
  type SetValue,
} from "../../domain/market";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImage, ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls } from "../../patterns/ViewControls";
import { pageAfterResize, usePage, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { Pagination, SidebarItem } from "../../primitives/navigation";
import { cn } from "../../primitives/cn";
import { Badge, Card, Chip, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { DucatBadge, fmt } from "../../patterns/MarketBadges";
import { SetFiltersPopover } from "./SetFiltersPopover";
import { openPartInfo, openSetInfo, setImage, SetPartsTable, SetValueLine, useSetData, type RelicLookup } from "./SetParts";

const SORT_LABEL: Readonly<Record<SetFilters["sort"], string>> = {
  value: "Most platinum",
  plat: "Highest set price",
  ducats: "Most ducats",
  az: "Name, A–Z",
  za: "Name, Z–A",
};

function SetCard({
  set,
  summary,
  value,
  note,
  ctx,
  relics,
  building,
  baseUrl,
}: {
  set: PrimeSet;
  summary: SetSummary;
  value: SetValue;
  note: string | null;
  ctx: SetContext;
  relics: RelicLookup;
  building: boolean;
  baseUrl: string | undefined;
}) {
  return (
    <li>
      <Card as="article" padding="sm" interactive className={cn("flex h-full flex-col gap-2", summary.complete && "border-success/60")}>
        <header className="flex items-center gap-3">
          <ItemImage size="lg" sources={imageSources(setImage(set) ?? undefined, baseUrl)} name={set.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="flex min-w-0 text-sm">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  openSetInfo(set);
                }}
                className="truncate rounded-sm text-start font-semibold hover:text-accent hover:underline"
              >
                {set.name}
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
            {note && <p className="truncate text-xs text-accent">{note}</p>}
          </div>
        </header>
        <SetPartsTable
          set={set}
          ctx={ctx}
          relics={relics}
          onOpenPart={(part) => {
            openPartInfo(set, part);
          }}
        />
        <SetValueLine value={value} complete={summary.complete} loading={ctx.prices.size === 0} name={set.name} />
      </Card>
    </li>
  );
}

/** Prime sets: completion, duplicates and what selling them is worth. Filters are local. */
export function SetsTab() {
  const { sets, ctx, relics, isPending } = useSetData();
  const { own, lookup } = ctx;
  const crafting = useCrafting();
  const baseUrl = useImageBaseUrl();
  const [filters, setFilters] = useState<SetFilters>(DEFAULT_SET_FILTERS);

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
                placeholder="Set, part, vaulted, category…"
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
            {isPending ? (
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
                {rows.slice(pager.start, pager.end).map(({ set: s, summary, value, reason }) => (
                  <SetCard
                    key={s.name}
                    set={s}
                    summary={summary}
                    value={value}
                    note={reason}
                    ctx={ctx}
                    relics={relics}
                    building={building(s)}
                    baseUrl={baseUrl}
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
