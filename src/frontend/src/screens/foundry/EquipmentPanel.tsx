import { Hammer, PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { imageSources } from "../../api/catalog";
import { useCraftableItems, useRecipes } from "../../api/foundry";
import { useFilterPresets } from "../../api/presets";
import { useSettings } from "../../api/settings";
import {
  applyBuildingFilter,
  applyReadyFilter,
  categoryProgress,
  DEFAULT_FOUNDRY_FILTERS,
  filterItems,
  FOUNDRY_SORTS,
  FOUNDRY_STATUSES,
  foundrySortFrom,
  foundryPresetCodec,
  mergeComponents,
  patchFilters,
  percent,
  sortItems,
  statusOf,
  withStatus,
  type FoundryFilters,
  type FoundryItem,
  type FoundrySort,
  type FoundryStatus,
  type RecipeComponent,
} from "../../domain/foundry";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImage, ItemImagesContext } from "../../patterns/ItemImage";
import { pageAfterResize, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { PresetBar } from "../../patterns/PresetBar";
import { useShowImages, useShowRecipes, ViewControls, type View } from "../../patterns/ViewControls";
import { Button } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Table, type TableColumn } from "../../primitives/data";
import { Alert, Card, Chip, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { Pagination } from "../../primitives/navigation";
import { CraftCard, FoundryWikiMenu, RecipeButton, StatusBadges, TrackButton, type CraftInfo } from "./CraftCard";
import { useCraftInfo } from "./useCraftInfo";

const VIEW_KEY = "ff-view-foundry";
/** Stored view names from older settings: icons/text-cards are Cards, list-compact is List. */
const readView = (): View => {
  const v = localStorage.getItem(VIEW_KEY);
  return v === "list" || v === "list-compact" ? "list" : "cards";
};
const SORT_KEY = "ff-sort-foundry";

const fmt = (n: number) => n.toLocaleString("en-US");
const EMPTY_ITEMS: FoundryItem[] = [];

type ChipDef = { key: keyof FoundryFilters; label: string };
/** Filter chips next to the status pills; Ready/Missing/Unmastered are status pills. */
const CHIP_GROUPS: ReadonlyArray<{ label: string; chips: readonly ChipDef[] }> = [
  {
    label: "Prime and vault",
    chips: [
      { key: "filterPrime", label: "Prime" },
      { key: "filterNonPrime", label: "Non-Prime" },
      { key: "filterVaulted", label: "Vaulted" },
      { key: "filterUnvaulted", label: "Unvaulted" },
    ],
  },
  {
    label: "Ownership",
    chips: [
      { key: "filterOwned", label: "Owned" },
      // Treats Forma and Kuva as always owned when filtering.
      { key: "ignoreFormaKuva", label: "Count Forma/Kuva as owned" },
    ],
  },
  {
    label: "Mastery",
    chips: [
      { key: "filterMastered", label: "Mastered" },
      { key: "filterLvlCap", label: "Level cap above 30" },
    ],
  },
];

type Props = {
  filters: FoundryFilters;
  onFiltersChange: (next: FoundryFilters) => void;
  onOpen: (item: FoundryItem) => void;
};

/** Craftable items of one category with in-game style status pills (the former Foundry screen). */
export function EquipmentPanel({ filters, onFiltersChange, onOpen }: Props) {
  const craftable = useCraftableItems();
  const { own, crafting, baseUrl, infoFor, toggleTrack, ctx } = useCraftInfo(onOpen);
  const { data: settings } = useSettings();

  const [building, setBuilding] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<View>(readView);
  const [sort, setSort] = useState<FoundrySort>(() => foundrySortFrom(localStorage.getItem(SORT_KEY)));

  // Any filter change (including presets and the navigator) starts at page 1; inventory updates do not.
  const [seenFilters, setSeenFilters] = useState(filters);
  if (seenFilters !== filters) {
    setSeenFilters(filters);
    setPage(0);
  }
  const set = (patch: Partial<FoundryFilters>) => {
    onFiltersChange(patchFilters(filters, patch));
  };
  const status = statusOf(filters, building);
  const setStatus = (next: FoundryStatus) => {
    setBuilding(next === "building");
    setPage(0);
    onFiltersChange(withStatus(filters, next));
  };
  const codec = useMemo(() => foundryPresetCodec(filters.activeCat), [filters.activeCat]);
  const presets = useFilterPresets(codec, filters, onFiltersChange, DEFAULT_FOUNDRY_FILTERS);

  const items = craftable.data ?? EMPTY_ITEMS;
  const progress = useMemo(() => categoryProgress(items, own), [items, own]);
  const catProgress = progress[filters.activeCat] ?? { done: 0, total: 0 };
  // Chosen in the toolbar; an older stored setting counts until then.
  const [pageSize, setPageSize] = usePageSize("foundry", settings?.foundryPageSize);
  const [cardScale, setCardScale] = useCardScale("foundry");
  const [showImages, setShowImages] = useShowImages("foundry");
  const [showRecipes, setShowRecipes] = useShowRecipes("foundry");

  // "Ready" and "Building" need recipes; fetch them for every candidate, not only visited pages.
  const needsRecipes = filters.filterReady || building;
  const candidates = useMemo(() => filterItems(items, filters, own), [items, filters, own]);
  const candidateIds = useMemo(() => (needsRecipes ? candidates.map((i) => i.unique_name) : []), [candidates, needsRecipes]);
  const allRecipes = useRecipes(candidateIds, needsRecipes);
  const visible = useMemo(() => {
    if (!needsRecipes) return sortItems(candidates, sort, own);
    if (!allRecipes) return [];
    const ready = applyReadyFilter(candidates, filters, allRecipes, own);
    return sortItems(building ? applyBuildingFilter(ready, allRecipes, crafting) : ready, sort, own);
  }, [candidates, filters, allRecipes, own, building, crafting, needsRecipes, sort]);
  const checking = needsRecipes && allRecipes === null;

  // Counts on the pills that need no recipes; Ready and Building show theirs once known.
  const pillCounts = useMemo((): Partial<Record<FoundryStatus, number>> => {
    const base = withStatus(filters, "all");
    return {
      all: filterItems(items, base, own).length,
      missing: filterItems(items, withStatus(base, "missing"), own).length,
      unmastered: filterItems(items, withStatus(base, "unmastered"), own).length,
      building: crafting.length,
      ...(status === "ready" && !checking ? { ready: visible.length } : {}),
    };
  }, [items, filters, own, crafting.length, status, checking, visible.length]);

  const pageCount = Math.ceil(visible.length / pageSize);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  const scroller = useScrollTopOn(current);
  const pageItems = useMemo(() => visible.slice(current * pageSize, (current + 1) * pageSize), [visible, current, pageSize]);
  const pageIds = useMemo(() => pageItems.map((i) => i.unique_name), [pageItems]);
  const pageRecipes = useRecipes(pageIds, !needsRecipes);

  const recipeOf = (id: string): RecipeComponent[] | null => allRecipes?.get(id) ?? pageRecipes?.get(id) ?? null;
  const info = (item: FoundryItem) => infoFor(item, recipeOf(item.unique_name));

  const collected = `${fmt(catProgress.done)} / ${fmt(catProgress.total)} collected (${String(percent(catProgress))}%)`;
  const cardCtx = { ...ctx, showParts: showRecipes };
  const countLabel = checking ? "Checking recipes…" : `${fmt(visible.length)} item${visible.length === 1 ? "" : "s"} · ${collected}`;

  const columns: Array<TableColumn<CraftInfo>> = [
    {
      id: "track",
      header: "Track",
      hideHeader: true,
      cell: (r) => (
        <TrackButton
          name={r.item.name}
          tracked={r.tracked}
          onToggle={() => {
            toggleTrack(r.item);
          }}
        />
      ),
    },
    {
      id: "name",
      header: "Item",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <ItemImage size="sm" sources={imageSources(r.item.image_name ?? undefined, baseUrl)} name={r.item.name} />
          <RecipeButton item={r.item} onOpen={onOpen} />
        </span>
      ),
    },
    { id: "category", header: "Category", cell: (r) => <span className="text-muted">{r.item.category}</span> },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadges info={r} />
        </span>
      ),
    },
    {
      id: "parts",
      header: "Parts",
      align: "end",
      cell: (r) =>
        r.item.source_type ? (
          <span className="text-muted italic">Acquired in-game</span>
        ) : r.recipe === null ? (
          <span className="text-muted">…</span>
        ) : (
          <span className="tabular-nums">{mergeComponents(r.recipe).length}</span>
        ),
    },
    { id: "actions", header: "Actions", hideHeader: true, cell: (r) => <FoundryWikiMenu name={r.item.name} /> },
  ];

  const pager = <Pagination page={current} pageCount={pageCount} onPageChange={setPage} summary={countLabel} compact />;

  // List view: the table fills the area below the toolbar and scrolls itself (sticky header).
  const tableMode = view === "list" && !craftable.isError && !(craftable.isPending || checking) && items.length > 0 && visible.length > 0;
  return (
    <ItemImagesContext value={showImages}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SearchInput
              label="Search recipes"
              placeholder="Search recipes (comma-separated)…"
              value={filters.search}
              onValueChange={(search) => {
                set({ search });
              }}
              size="sm"
              className="w-72"
            />
            <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
              {FOUNDRY_STATUSES.map((s) => {
                const count = pillCounts[s.id];
                return (
                  <Chip
                    key={s.id}
                    active={status === s.id}
                    onActiveChange={() => {
                      setStatus(s.id === status ? "all" : s.id);
                    }}
                  >
                    {s.label}
                    {count !== undefined && <span className="text-muted tabular-nums">{fmt(count)}</span>}
                  </Chip>
                );
              })}
            </div>
            {CHIP_GROUPS.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="flex flex-wrap gap-1">
                {g.chips.map((c) => (
                  <Chip
                    key={c.key}
                    active={filters[c.key] as boolean}
                    onActiveChange={(v) => {
                      set({ [c.key]: v });
                    }}
                  >
                    {c.label}
                  </Chip>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PresetBar model={presets} label="Foundry" />
            <label className="flex items-center gap-2 text-xs text-muted">
              Sort
              <Select
                size="sm"
                value={sort}
                onChange={(e) => {
                  const next = foundrySortFrom(e.target.value);
                  setSort(next);
                  setPage(0);
                  localStorage.setItem(SORT_KEY, next);
                }}
                className="w-40"
              >
                {FOUNDRY_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
            <ViewControls
              screen="foundry"
              view={view}
              onViewChange={(next) => {
                setView(next);
                localStorage.setItem(VIEW_KEY, next);
              }}
              scale={cardScale}
              onScaleChange={setCardScale}
              pageSize={pageSize}
              onPageSizeChange={(next) => {
                setPage(pageAfterResize(current, pageSize, next));
                setPageSize(next);
              }}
              images={showImages}
              onImagesChange={setShowImages}
              recipes={showRecipes}
              onRecipesChange={setShowRecipes}
            />
          </div>
          {pager}
        </div>

        <div ref={scroller} className={cn("flex min-h-0 flex-1 flex-col", tableMode ? "" : "gap-3 overflow-y-auto p-4")}>
          {craftable.isError ? (
            <Alert
              tone="danger"
              title="Could not load the recipes."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void craftable.refetch();
                  }}
                >
                  Retry
                </Button>
              }
            >
              The item database did not answer. Try again, or refresh the item list in Settings.
            </Alert>
          ) : craftable.isPending || checking ? (
            <ul aria-busy="true" className={CARD_GRID} style={cardGridStyle(16, cardScale)}>
              {Array.from({ length: 9 }, (_, i) => (
                <li key={i}>
                  <Card padding="sm">
                    <Skeleton lines={5} />
                  </Card>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <EmptyState icon={Hammer} title="No recipes loaded." description="Refresh the item list in Settings first." />
          ) : visible.length === 0 ? (
            status === "building" ? (
              <EmptyState icon={Hammer} title="Nothing is building." description="Items you start in the Foundry show up here." />
            ) : (
              <EmptyState icon={PackageOpen} title="No items match." description="Change the search or the filters." />
            )
          ) : view === "cards" ? (
            <ul className={CARD_GRID} style={cardGridStyle(16, cardScale)}>
              {pageItems.map((item) => (
                <CraftCard key={item.unique_name} info={info(item)} ctx={cardCtx} />
              ))}
            </ul>
          ) : (
            <Table
              label="Foundry"
              className="flex-1 rounded-none border-0"
              scrollTopKey={current}
              columns={showRecipes ? columns : columns.filter((c) => c.id !== "parts")}
              data={pageItems.map(info)}
              getRowId={(r) => r.item.unique_name}
            />
          )}
        </div>
      </div>
    </ItemImagesContext>
  );
}
