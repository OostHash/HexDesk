import { PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useImageBaseUrl } from "../../api/catalog";
import { useModCounts, useOwnership } from "../../api/inventory";
import { prioritisePrice, useCatalogList, useLivePrices, useQueuePrices, useWfmLookup } from "../../api/market";
import { DEFAULT_MOD_FILTERS, modQty, normalizeForWfm, priceOf, slugFor, visibleMods, type ModFilters } from "../../domain/market";
import { cardSubline, limitRows, rankRows } from "../../domain/items";
import { useCardMeta } from "../../api/items";
import { useSaveSettings, useSettings } from "../../api/settings";
import { openItemInfo } from "../../state/itemInfo";
import { ItemCard } from "./ItemCard";
import { Card, EmptyState, Skeleton } from "../../primitives/display";
import { RadioGroup, SearchInput, Select } from "../../primitives/forms";
import { Pagination } from "../../primitives/navigation";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls } from "../../patterns/ViewControls";
import { pageAfterResize, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { fmt } from "../../patterns/MarketBadges";
import type { MarketTarget } from "../../domain/market";

const SORT_LABEL: Readonly<Record<ModFilters["sort"], string>> = {
  qty: "Most owned",
  plat: "Most platinum",
  az: "Name, A–Z",
  za: "Name, Z–A",
};

/** Mods and arcanes with copies per rank and prices. Filters are local. */
export function ModsTab({ onOpen }: { onOpen: (target: MarketTarget) => void }) {
  const catalog = useCatalogList();
  const { ownership: own } = useOwnership();
  const mods = useModCounts();
  const lookup = useWfmLookup();
  const { prices } = useLivePrices();
  const baseUrl = useImageBaseUrl();
  const cardMeta = useCardMeta();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const favoriteList = settings?.favorites;
  const favorites = useMemo(() => new Set(Array.isArray(favoriteList) ? (favoriteList as string[]) : []), [favoriteList]);
  const toggleFavorite = (id: string) => {
    const next = favorites.has(id) ? [...favorites].filter((f) => f !== id) : [...favorites, id];
    saveSettings.mutate({ favorites: next });
  };
  const [filters, setFilters] = useState<ModFilters>(DEFAULT_MOD_FILTERS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = usePageSize("mods");
  const [cardScale, setCardScale] = useCardScale("mods");
  const [showImages, setShowImages] = useShowImages("mods");
  const set = (patch: Partial<ModFilters>) => {
    setFilters({ ...filters, ...patch });
    setPage(0);
  };

  const all = useMemo(() => catalog.data ?? [], [catalog.data]);
  const rows = useMemo(() => visibleMods(all, filters, { own, mods, lookup, prices }), [all, filters, own, mods, lookup, prices]);
  const total = useMemo(() => all.filter((i) => i.category === "Mods" || i.category === "Arcanes"), [all]);
  const ownedCount = useMemo(() => total.filter((i) => modQty(own, mods, i.unique_name) > 0).length, [total, own, mods]);
  const pageCount = Math.ceil(rows.length / pageSize);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  const scroller = useScrollTopOn(current);
  const pageItems = rows.slice(current * pageSize, (current + 1) * pageSize);
  useQueuePrices(useMemo(() => pageItems.flatMap((i) => lookup.get(normalizeForWfm(i.name)) ?? []), [pageItems, lookup]));

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
              label="Search mods and arcanes"
              placeholder="Search mods & arcanes…"
              value={filters.search}
              onValueChange={(search) => {
                set({ search });
              }}
              size="sm"
              className="w-64"
            />
            <RadioGroup
              legend="Type"
              hideLegend
              appearance="segmented"
              value={filters.type}
              onValueChange={(type) => {
                set({ type });
              }}
              options={[
                { value: "all", label: "All types" },
                { value: "mods", label: "Mods" },
                { value: "arcanes", label: "Arcanes" },
              ]}
            />
            <RadioGroup
              legend="Ownership"
              hideLegend
              appearance="segmented"
              value={filters.owned}
              onValueChange={(owned) => {
                set({ owned });
              }}
              options={[
                { value: "all", label: "Owned or not" },
                { value: "owned", label: "Owned" },
                { value: "notowned", label: "Not owned" },
              ]}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              Sort
              <Select
                size="sm"
                value={filters.sort}
                onChange={(e) => {
                  set({ sort: e.target.value as ModFilters["sort"] });
                }}
                className="w-40"
              >
                {(Object.keys(SORT_LABEL) as Array<ModFilters["sort"]>).map((m) => (
                  <option key={m} value={m}>
                    {SORT_LABEL[m]}
                  </option>
                ))}
              </Select>
            </label>
            <ViewControls
              screen="mods"
              scale={cardScale}
              onScaleChange={setCardScale}
              pageSize={pageSize}
              onPageSizeChange={(next) => {
                setPage(pageAfterResize(current, pageSize, next));
                setPageSize(next);
              }}
              images={showImages}
              onImagesChange={setShowImages}
            />
          </div>
          <Pagination
            page={current}
            pageCount={pageCount}
            onPageChange={setPage}
            summary={`${fmt(ownedCount)} owned · ${fmt(total.length)} total · ${fmt(rows.length)} shown`}
            compact
          />
        </div>

        <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-6">
          {catalog.isPending ? (
            <ul aria-busy="true" className={CARD_GRID} style={cardGridStyle(10, cardScale)}>
              {Array.from({ length: 12 }, (_, i) => (
                <li key={i}>
                  <Card padding="sm">
                    <Skeleton lines={4} />
                  </Card>
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <EmptyState icon={PackageOpen} title="No mods or arcanes match." description="Change the search or the filters." />
          ) : (
            <ul className={CARD_GRID} style={cardGridStyle(10, cardScale)}>
              {pageItems.map((item) => {
                const slug = slugFor(lookup, item.name);
                const price = priceOf(prices, slug);
                const count = modQty(own, mods, item.unique_name);
                const meta = cardMeta[item.unique_name];
                const imageName = item.image_name ?? null;
                return (
                  <ItemCard
                    key={item.unique_name}
                    name={item.name}
                    imageName={imageName}
                    baseUrl={baseUrl}
                    subline={cardSubline(item.category, meta)}
                    rarity={meta?.rarity}
                    count={count === 0 ? "—" : fmt(count)}
                    countLabel={count === 0 ? "Not owned" : `${fmt(count)} owned`}
                    missing={count === 0}
                    plat={price}
                    ducats={null}
                    onOpenMarket={() => {
                      open({ slug, name: item.name, imageName, rank: null });
                    }}
                    onOpen={() => {
                      openItemInfo({ uniqueName: item.unique_name, name: item.name, imageName, category: item.category });
                    }}
                    favorite={favorites.has(item.unique_name)}
                    onToggleFavorite={() => {
                      toggleFavorite(item.unique_name);
                    }}
                    rows={limitRows(rankRows(mods[item.unique_name]?.by_rank, meta?.max_rank))}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ItemImagesContext>
  );
}
