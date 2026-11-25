import { ChevronDown, Hammer, Layers, PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useBulkPrices, useChangeLog, useCrafting, useItemListStatus, useModCounts, useOwnership } from "../../api/inventory";
import { useFilterPresets } from "../../api/presets";
import { useCatalogIndex } from "../../api/relics";
import { useCardMeta } from "../../api/items";
import { useWfmLookup } from "../../api/market";
import { cardSubline, itemRows, limitRows, rankRows } from "../../domain/items";
import { normalizeForWfm } from "../../domain/market";
import { openItemInfo } from "../../state/itemInfo";
import { openItemWindow } from "../../state/itemWindow";
import { useSaveSettings, useSettings } from "../../api/settings";
import {
  availableRanks,
  CATEGORIES,
  categoryCounts,
  DEFAULT_INVENTORY_FILTERS,
  effectiveSort,
  inventoryPresetCodec,
  lastChangedMap,
  recentSince,
  recentWindowFrom,
  needsPrices,
  recentDelta,
  toggleRank,
  visibleItems,
  type InventoryCatalogItem,
  type InventoryFilters,
  type InventoryRow,
  type ModRankFilter,
  type SortMode,
} from "../../domain/inventory";
import { ItemImage } from "../../patterns/ItemImage";
import { PresetBar } from "../../patterns/PresetBar";
import { Table, type TableColumn } from "../../primitives/data";
import { Badge, Card, Chip, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { Button } from "../../primitives/actions";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls, type View } from "../../patterns/ViewControls";
import { Popover } from "../../primitives/overlay";
import { cn } from "../../primitives/cn";
import { Pagination, SidebarItem } from "../../primitives/navigation";
import { ChangeBadge, FavoriteButton, ItemCard, MasteryBadge, PriceBadges, type ItemCardProps } from "./ItemCard";
import { useInventoryFilters } from "../../state/inventoryFilters";
import { useMinuteNow } from "../../state/useNow";
import { APP_STARTED_AT } from "../../state/session";
import { pageAfterResize, usePage, usePageSize, useScrollTopOn } from "../../patterns/PageSize";

const VIEW_KEY = "ff-view-inventory";
const readView = (): View => {
  const v = localStorage.getItem(VIEW_KEY);
  return v === "list" || v === "list-compact" ? "list" : "cards";
};

const SORT_LABEL: Readonly<Record<SortMode, string>> = {
  "qty-desc": "Quantity, high to low",
  "qty-asc": "Quantity, low to high",
  "name-asc": "Name, A–Z",
  "name-desc": "Name, Z–A",
  "plat-desc": "Platinum, high to low",
  "plat-asc": "Platinum, low to high",
  "ducat-desc": "Ducats, high to low",
  "ducat-asc": "Ducats, low to high",
  "ducat-ratio-desc": "Ducats per platinum, high to low",
  "ducat-ratio-asc": "Ducats per platinum, low to high",
};

/** Button text of the rank filter: "Any", "Unranked", "5, 10" or "4 ranks". */
const rankSummary = (ranks: readonly ModRankFilter[]) =>
  ranks.length === 0
    ? "Any"
    : ranks.length > 2
      ? `${String(ranks.length)} ranks`
      : ranks.map((r) => (r === "unranked" ? "Unranked" : String(r))).join(", ");

const fmt = (n: number) => n.toLocaleString("en-US");

/** The Items tab of Inventory: every catalogue item with your quantity, by category. */
export function ItemsTab() {
  const { index, isPending: catalogPending } = useCatalogIndex();
  const { ownership, isPending: ownPending } = useOwnership();
  const { prices, status: priceStatus } = useBulkPrices();
  const changes = useChangeLog().data ?? EMPTY_CHANGES;
  const mods = useModCounts();
  const crafting = useCrafting();
  const baseUrl = useImageBaseUrl();
  const cardMeta = useCardMeta();
  const lookup = useWfmLookup();
  const listStatus = useItemListStatus();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  // "1m ago" labels: a minute clock, so 1000 cards do not redraw every second.
  const nowSec = Math.floor(useMinuteNow() / 1000);

  // Window-wide: kept when you switch screens; the changelog dock sets them too.
  const [filters, setFilters] = useInventoryFilters();
  const [fallbackSort, setFallbackSort] = useState<SortMode>("qty-desc");
  const [view, setView] = useState<View>(readView);
  const [cardScale, setCardScale] = useCardScale("inventory");
  const [showImages, setShowImages] = useShowImages("inventory");
  const presets = useFilterPresets(inventoryPresetCodec, filters, setFilters, DEFAULT_INVENTORY_FILTERS);
  const set = (patch: Partial<InventoryFilters>) => {
    if (patch.sortMode && !needsPrices(patch.sortMode)) setFallbackSort(patch.sortMode);
    setFilters({ ...filters, ...patch });
  };

  const items = useMemo(() => [...index.byName.values()] as InventoryCatalogItem[], [index]);
  const recentFrom = recentSince(recentWindowFrom(settings?.recentWindow), nowSec, APP_STARTED_AT);
  const lastChanged = useMemo(() => lastChangedMap(changes, recentFrom), [changes, recentFrom]);
  const { rows } = useMemo(
    () => visibleItems(filters, { items, own: ownership, prices, lastChanged, mods }, fallbackSort),
    [filters, items, ownership, prices, lastChanged, mods, fallbackSort],
  );
  // Pages of the size chosen in the toolbar; new filters start at page 1 again.
  const [pageSize, setPageSize] = usePageSize("inventory");
  const pager = usePage(rows.length, pageSize, filters);
  const scroller = useScrollTopOn(pager.page);
  const pageRows = useMemo(() => rows.slice(pager.start, pager.end), [rows, pager.start, pager.end]);
  const counts = useMemo(() => categoryCounts(items, ownership), [items, ownership]);
  const ranks = useMemo(() => availableRanks(mods), [mods]);
  const favoriteList = settings?.favorites;
  const favorites = useMemo(() => new Set(Array.isArray(favoriteList) ? (favoriteList as string[]) : []), [favoriteList]);
  const buildingByItem = useMemo(() => new Map(crafting.map((c) => [c.unique_name, c.item_name])), [crafting]);

  const toggleFavorite = (id: string) => {
    const next = favorites.has(id) ? [...favorites].filter((f) => f !== id) : [...favorites, id];
    saveSettings.mutate({ favorites: next });
  };
  const openInfo = (item: InventoryCatalogItem) => {
    openItemInfo({ uniqueName: item.unique_name, name: item.name, imageName: item.image_name ?? null, category: item.category });
  };
  const cardFor = (row: InventoryRow): ItemCardProps => {
    const { item, qty, plat, ducats, mastery } = row;
    const meta = cardMeta[item.unique_name];
    const building = buildingByItem.has(item.unique_name);
    const recent = recentDelta(changes, item.unique_name, recentFrom, nowSec);
    const slug = lookup.get(normalizeForWfm(item.name));
    const ranked = item.category === "Mods" || item.category === "Arcanes";
    return {
      name: item.name,
      imageName: item.image_name,
      baseUrl,
      subline: cardSubline(item.category, meta),
      rarity: meta?.rarity,
      count: fmt(qty),
      countLabel: `${fmt(qty)} owned`,
      missing: qty === 0 && !building,
      plat,
      ducats,
      onOpenMarket: slug
        ? () => {
            openItemWindow({ slug, name: item.name, imageName: item.image_name ?? null, rank: null });
          }
        : undefined,
      onOpen: () => {
        openInfo(item);
      },
      favorite: favorites.has(item.unique_name),
      onToggleFavorite: () => {
        toggleFavorite(item.unique_name);
      },
      badges: recent ? <ChangeBadge recent={recent} /> : undefined,
      recent,
      rows: limitRows(ranked ? rankRows(mods[item.unique_name]?.by_rank, meta?.max_rank) : itemRows(item, mastery, building)),
    };
  };

  const waitingForPrices = needsPrices(filters.sortMode) && effectiveSort(filters, prices !== null, fallbackSort) !== filters.sortMode;
  const countLabel = waitingForPrices
    ? priceStatus === "loading"
      ? "Loading platinum prices…"
      : "Platinum prices unavailable"
    : `${fmt(rows.length)} item${rows.length === 1 ? "" : "s"}`;

  const columns: Array<TableColumn<InventoryRow>> = [
    {
      id: "favorite",
      header: "Favourite",
      hideHeader: true,
      cell: (r) => (
        <FavoriteButton
          name={r.item.name}
          favorite={favorites.has(r.item.unique_name)}
          onToggle={() => {
            toggleFavorite(r.item.unique_name);
          }}
        />
      ),
    },
    {
      id: "name",
      header: "Item",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <ItemImage size="sm" sources={imageSources(r.item.image_name ?? undefined, baseUrl)} name={r.item.name} />
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              openInfo(r.item);
            }}
            className="truncate rounded-sm hover:text-accent hover:underline"
          >
            {r.item.name}
          </button>
          <MasteryBadge rank={r.mastery} />
          {buildingByItem.has(r.item.unique_name) && (
            <Badge tone="info" icon={Hammer}>
              Building
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <span className="text-muted">{r.item.category}</span>,
    },
    {
      id: "values",
      header: "Value",
      cell: (r) => (
        <span className="flex gap-1">
          <PriceBadges plat={r.plat} ducats={r.ducats} />
        </span>
      ),
    },
    {
      id: "qty",
      header: "Quantity",
      align: "end",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <ChangeBadge recent={recentDelta(changes, r.item.unique_name, recentFrom, nowSec)} />
          {fmt(r.qty)}
        </span>
      ),
    },
  ];

  // List view: the table fills the area below the toolbar and scrolls itself (sticky header).
  const tableMode = view === "list" && !(catalogPending || ownPending) && rows.length > 0;
  return (
    <ItemImagesContext value={showImages}>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Inventory categories" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2">
          <ul className="flex flex-col gap-0.5">
            {CATEGORIES.map((c) => {
              const owned = counts.owned[c.id] ?? 0;
              const total = counts.total[c.id] ?? 0;
              return (
                <li key={c.id}>
                  <SidebarItem
                    active={filters.category === c.id}
                    label={c.label}
                    badge={<span className="text-xs text-muted tabular-nums">{owned > 0 ? `${fmt(owned)} / ${fmt(total)}` : fmt(total)}</span>}
                    onClick={() => {
                      set({ category: c.id });
                    }}
                  />
                </li>
              );
            })}
          </ul>
          {listStatus && (
            <p className="mt-auto px-3 pt-3 text-xs text-muted">
              {fmt(listStatus.count)} items · {fmt(listStatus.recipe_count)} recipes
            </p>
          )}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <SearchInput
                label="Search items"
                placeholder="Search items (comma-separated)…"
                value={filters.search}
                onValueChange={(search) => {
                  set({ search });
                }}
                size="sm"
                className="w-72"
              />
              <div role="group" aria-label="Filters" className="flex flex-wrap gap-1">
                <Chip
                  active={filters.filterOwned}
                  onActiveChange={(v) => {
                    set({ filterOwned: v });
                  }}
                >
                  Owned
                </Chip>
                <Chip
                  active={filters.filterRecent}
                  onActiveChange={(v) => {
                    set({ filterRecent: v });
                  }}
                >
                  Changed recently
                </Chip>
                <Chip
                  active={filters.filterPrime}
                  onActiveChange={(v) => {
                    set({ filterPrime: v });
                  }}
                >
                  Prime
                </Chip>
                <Chip
                  active={filters.filterVaulted}
                  onActiveChange={(v) => {
                    set({ filterVaulted: v });
                  }}
                >
                  Vaulted
                </Chip>
                <Chip
                  active={filters.filterUnvaulted}
                  onActiveChange={(v) => {
                    set({ filterUnvaulted: v });
                  }}
                >
                  Unvaulted
                </Chip>
                <Chip
                  active={filters.filterTradeable}
                  onActiveChange={(v) => {
                    set({ filterTradeable: v });
                  }}
                >
                  Tradeable
                </Chip>
              </div>
              {ranks.length > 0 && (
                <Popover
                  label="Mod rank"
                  placement="bottom"
                  className="w-72"
                  trigger={(props) => (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-control-sm items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-hover hover:text-text",
                        filters.filterRank.length === 0 ? "border-border text-muted" : "border-accent text-text",
                      )}
                      {...props}
                    >
                      <Layers aria-hidden="true" className="size-3" />
                      Rank: {rankSummary(filters.filterRank)}
                      <ChevronDown aria-hidden="true" className="size-3" />
                    </button>
                  )}
                >
                  <div className="flex flex-col gap-2">
                    <div role="group" aria-label="Mod rank" className="flex flex-wrap gap-1">
                      {(["unranked", ...ranks] as const).map((r) => (
                        <Chip
                          key={r}
                          active={filters.filterRank.includes(r)}
                          onActiveChange={() => {
                            set({ filterRank: toggleRank(filters.filterRank, r) });
                          }}
                        >
                          {r === "unranked" ? "Unranked" : `Rank ${String(r)}`}
                        </Chip>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={filters.filterRank.length === 0}
                      onClick={() => {
                        set({ filterRank: [] });
                      }}
                      className="self-start"
                    >
                      Any rank
                    </Button>
                  </div>
                </Popover>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <PresetBar model={presets} label="Inventory" />
              <label className="flex items-center gap-2 text-xs text-muted">
                Sort
                <Select
                  size="sm"
                  value={filters.sortMode}
                  onChange={(e) => {
                    set({ sortMode: e.target.value as SortMode });
                  }}
                  className="w-56"
                >
                  {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
                    <option key={m} value={m}>
                      {SORT_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </label>
              <ViewControls
                screen="inventory"
                view={view}
                onViewChange={(next) => {
                  setView(next);
                  localStorage.setItem(VIEW_KEY, next);
                }}
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
            <Pagination page={pager.page} pageCount={pager.pageCount} onPageChange={pager.setPage} summary={countLabel} compact />
          </div>

          <div ref={scroller} className={cn("flex min-h-0 flex-1 flex-col", tableMode ? "" : "gap-3 overflow-y-auto p-4")}>
            {catalogPending || ownPending ? (
              <ul aria-busy="true" className={CARD_GRID} style={cardGridStyle(11, cardScale)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <li key={i}>
                    <Card padding="sm">
                      <Skeleton lines={4} />
                    </Card>
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                title="No items found."
                description="Complete a mission or visit a relay to sync your inventory, or change the filters."
              />
            ) : view === "cards" ? (
              <ul className={CARD_GRID} style={cardGridStyle(11, cardScale)}>
                {pageRows.map((row) => (
                  <ItemCard key={row.item.unique_name} {...cardFor(row)} />
                ))}
              </ul>
            ) : (
              <Table
                label="Inventory"
                className="flex-1 rounded-none border-0"
                scrollTopKey={pager.page}
                columns={columns}
                data={pageRows}
                getRowId={(r) => r.item.unique_name}
              />
            )}
          </div>
        </div>
      </div>
    </ItemImagesContext>
  );
}

const EMPTY_CHANGES: never[] = [];
