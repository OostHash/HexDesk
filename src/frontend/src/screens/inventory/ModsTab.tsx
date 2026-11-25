import { PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useImageBaseUrl } from "../../api/catalog";
import { useModCounts, useOwnership } from "../../api/inventory";
import { prioritisePrice, useCatalogList, useLivePrices, useQueuePrices, useWfmLookup } from "../../api/market";
import { DEFAULT_MOD_FILTERS, modGroupCounts, modQty, normalizeForWfm, priceOf, slugFor, visibleMods, type ModFilters } from "../../domain/market";
import { cardSubline, limitRows, MOD_GROUPS, modDisplayName, rankRows } from "../../domain/items";
import { useCardMeta } from "../../api/items";
import { useOwnedRivens, useWeaponNames } from "../../api/rivens";
import { ownRivenCards, rivenGroupCount, rivenRows, veiledCounts, visibleRivens, type RivenEntry } from "../../domain/rivenCards";
import type { CatalogItem } from "../../domain/relics";
import { openRiven } from "../../state/navigation";
import { useSaveSettings, useSettings } from "../../api/settings";
import { openItemInfo } from "../../state/itemInfo";
import { ItemCard } from "./ItemCard";
import { ModFiltersPopover } from "./ModFiltersPopover";
import { availableRanks } from "../../domain/inventory";
import { matchMod } from "../../domain/modSearch";
import { Card, Chip, EmptyState, Skeleton } from "../../primitives/display";
import { SearchInput, Select } from "../../primitives/forms";
import { Pagination, SidebarItem } from "../../primitives/navigation";
import { CARD_GRID, cardGridStyle, useCardScale } from "../../patterns/CardScale";
import { ItemImagesContext } from "../../patterns/ItemImage";
import { useShowImages, ViewControls } from "../../patterns/ViewControls";
import { pageAfterResize, usePageSize, useScrollTopOn } from "../../patterns/PageSize";
import { fmt } from "../../patterns/MarketBadges";
import type { MarketTarget } from "../../domain/market";

const SECTION_LABEL = { all: "All mods and arcanes", mods: "Mods", arcanes: "Arcanes" } as const;

const RIVEN_GROUP = "mod-riven";

/** A card on the page: a catalogue mod or arcane, or an entry of the Rivens group. */
type Entry = { kind: "mod"; item: CatalogItem } | RivenEntry;

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
  const ownedRivens = useOwnedRivens();
  const weaponNames = useWeaponNames();
  const rivenCards = useMemo(() => ownRivenCards(ownedRivens.data ?? [], weaponNames), [ownedRivens.data, weaponNames]);
  const veiled = useMemo(() => veiledCounts(ownedRivens.data ?? []), [ownedRivens.data]);
  const imageOf = useMemo(() => new Map(all.map((i) => [i.unique_name, i.image_name ?? null])), [all]);
  const rivenCtx = useMemo(
    () => ({
      meta: cardMeta,
      price: (i: CatalogItem) => {
        const slug = lookup.get(normalizeForWfm(i.name));
        return slug ? (priceOf(prices, slug) ?? 0) : 0;
      },
    }),
    [cardMeta, prices, lookup],
  );
  const isRivens = filters.group === RIVEN_GROUP;
  // Rivens are listed from the inventory, not the catalogue: see src/frontend/src/domain/rivenCards.ts.
  const rows = useMemo(
    (): Entry[] =>
      isRivens
        ? visibleRivens(all, rivenCards, veiled, filters, rivenCtx)
        : visibleMods(all, filters, { own, mods, lookup, prices, meta: cardMeta }).map((item) => ({ kind: "mod", item })),
    [isRivens, all, rivenCards, veiled, filters, rivenCtx, own, mods, lookup, prices, cardMeta],
  );
  const ranks = useMemo(() => availableRanks(mods), [mods]);
  const counts = useMemo((): { owned: Record<string, number>; total: Record<string, number> } => {
    const out = modGroupCounts(all, { own, mods, meta: cardMeta });
    const rivens = rivenGroupCount(visibleRivens(all, rivenCards, veiled, { ...DEFAULT_MOD_FILTERS, group: RIVEN_GROUP }, rivenCtx));
    return { owned: { ...out.owned, [RIVEN_GROUP]: rivens.owned }, total: { ...out.total, [RIVEN_GROUP]: rivens.total } };
  }, [all, own, mods, cardMeta, rivenCards, veiled, rivenCtx]);
  const ownedCount = counts.owned[filters.group] ?? 0;
  const totalCount = counts.total[filters.group] ?? 0;
  const pageCount = Math.ceil(rows.length / pageSize);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  const scroller = useScrollTopOn(current);
  const pageItems = rows.slice(current * pageSize, (current + 1) * pageSize);
  useQueuePrices(
    useMemo(() => pageItems.flatMap((e) => (e.kind === "riven" ? [] : (lookup.get(normalizeForWfm(e.item.name)) ?? []))), [pageItems, lookup]),
  );

  const open = (t: MarketTarget) => {
    prioritisePrice(t.slug);
    onOpen(t);
  };

  return (
    <ItemImagesContext value={showImages}>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Mod and arcane categories" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2">
          {(["all", "mods", "arcanes"] as const).map((section) => (
            <ul key={section} aria-label={SECTION_LABEL[section]} className="flex flex-col gap-0.5">
              {section !== "all" && <li className="px-3 pt-3 pb-1 text-xs font-semibold text-muted">{SECTION_LABEL[section]}</li>}
              {MOD_GROUPS.filter((g) => g.section === section).map((g) => {
                const owned = counts.owned[g.id] ?? 0;
                const total = counts.total[g.id] ?? 0;
                return (
                  <li key={g.id}>
                    <SidebarItem
                      active={filters.group === g.id}
                      label={g.label}
                      badge={<span className="text-xs text-muted tabular-nums">{owned > 0 ? `${fmt(owned)} / ${fmt(total)}` : fmt(total)}</span>}
                      onClick={() => {
                        set({ group: g.id });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg px-4 py-3 lg:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <SearchInput
                label="Search mods and arcanes"
                placeholder="Name, element, polarity, effect…"
                value={filters.search}
                onValueChange={(search) => {
                  set({ search });
                }}
                size="sm"
                className="w-64"
              />
              <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
                <Chip
                  active={filters.owned}
                  onActiveChange={(owned) => {
                    set({ owned });
                  }}
                >
                  Owned
                </Chip>
                <Chip
                  active={filters.incomplete}
                  onActiveChange={(incomplete) => {
                    set({ incomplete });
                  }}
                >
                  Incomplete
                </Chip>
              </div>
              <ModFiltersPopover filters={filters} ranks={ranks} onChange={set} />
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
              summary={`${fmt(ownedCount)} owned · ${fmt(totalCount)} total · ${fmt(rows.length)} shown`}
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
                {pageItems.map((entry) => {
                  if (entry.kind === "riven") {
                    const r = entry.riven;
                    return (
                      <ItemCard
                        key={`riven-${r.id}`}
                        name={r.name}
                        imageName={imageOf.get(r.itemType) ?? null}
                        baseUrl={baseUrl}
                        subline={r.subline}
                        rarity={cardMeta[r.itemType]?.rarity}
                        count="1"
                        countLabel="1 owned"
                        missing={false}
                        plat={null}
                        ducats={null}
                        onOpen={() => {
                          openRiven(r.id);
                        }}
                        rows={rivenRows(r)}
                      />
                    );
                  }
                  const item = entry.item;
                  const slug = slugFor(lookup, item.name);
                  const price = priceOf(prices, slug);
                  const count =
                    entry.kind === "veiled" ? Math.max(entry.count, modQty(own, mods, item.unique_name)) : modQty(own, mods, item.unique_name);
                  const meta = cardMeta[item.unique_name];
                  const imageName = item.image_name ?? null;
                  return (
                    <ItemCard
                      key={item.unique_name}
                      name={modDisplayName(item)}
                      imageName={imageName}
                      baseUrl={baseUrl}
                      subline={cardSubline(item.category, meta)}
                      note={filters.search ? matchMod(filters.search, modDisplayName(item), meta).reason : null}
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
      </div>
    </ItemImagesContext>
  );
}
