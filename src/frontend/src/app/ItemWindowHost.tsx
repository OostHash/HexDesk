import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { imageSources, useImageBaseUrl } from "../api/catalog";
import { openExternal } from "../api/links";
import { prioritisePrice, useCatalogList, useWfmLookup } from "../api/market";
import { normalizeForWfm, type MarketTarget } from "../domain/market";
import { wikiUrl } from "../domain/wiki";
import { ItemImage } from "../patterns/ItemImage";
import { fmt } from "../patterns/MarketBadges";
import { Button } from "../primitives/actions";
import { Tab, TabList, TabPanel, Tabs } from "../primitives/navigation";
import { Modal } from "../primitives/overlay";
import { SetPartStrip, setTarget, useSetData } from "../screens/inventory/SetParts";
import { ItemInfoTab, useItemInfo, type ItemInfoData } from "../screens/iteminfo/ItemInfo";
import { MarketPanel } from "../screens/market/MarketPanel";
import type { InfoSection, ItemInfoTarget } from "../state/itemInfo";
import {
  closeItemWindow,
  ITEM_WINDOW_TABS,
  lastItemWindowTab,
  rememberItemWindowTab,
  useItemWindow,
  type ItemWindowRequest,
  type ItemWindowTab,
} from "../state/itemWindow";

const TAB_LABEL: Readonly<Record<ItemWindowTab, string>> = { market: "Market", info: "Info", relics: "Relics", drops: "Drops" };

/**
 * The catalogue item and the warframe.market item of a request. A request
 * from the market names only the market item, and one from a card only the
 * catalogue item; the other is found by name.
 */
function useResolved(request: ItemWindowRequest | null): { item: ItemInfoTarget | null; market: MarketTarget | null } {
  const catalog = useCatalogList();
  const { sets } = useSetData();
  const lookup = useWfmLookup();
  return useMemo(() => {
    if (!request) return { item: null, market: null };
    let item = request.item;
    if (!item && request.market) {
      const name = request.market.name.toLowerCase();
      const set = name.endsWith(" set") ? sets.find((s) => `${s.name} set`.toLowerCase() === name) : undefined;
      const found = set ? null : catalog.data?.find((i) => i.name.toLowerCase() === name);
      item = set
        ? setTarget(set)
        : found
          ? { uniqueName: found.unique_name, name: found.name, imageName: found.image_name ?? request.market.imageName, category: found.category }
          : null;
    }
    let market = request.market;
    if (!market && item) {
      const slug = lookup.get(normalizeForWfm(item.name));
      market = slug ? { slug, name: item.name, imageName: item.imageName, rank: null } : null;
    }
    return { item, market };
  }, [request, catalog.data, sets, lookup]);
}

function WindowTabs({ info, market, requested }: { info: ItemInfoData | null; market: MarketTarget | null; requested: ItemWindowTab | null }) {
  const available = ITEM_WINDOW_TABS.filter((tab) => {
    if (tab === "market") return market !== null && (info?.tradable ?? true);
    if (!info) return false;
    if (tab === "info") return true;
    return info.byTab[tab].length > 0;
  });
  const [chosen, setChosen] = useState<ItemWindowTab>(() => requested ?? lastItemWindowTab());
  // A ranked mod's market follows a rank picked on the Info tab; until then it shows the rank it was opened at.
  const marketTarget = market && info?.rankPicked && info.maxRank > 0 ? { ...market, rank: info.ctx.rank } : market;
  // Until the item's details load, a remembered Relics or Drops tab may not be known yet.
  const selected = available.includes(chosen) ? chosen : (available[0] ?? "info");
  useEffect(() => {
    if (market) prioritisePrice(market.slug);
  }, [market]);
  if (available.length === 0) return <p className="text-sm text-muted">Nothing more is known about this item.</p>;
  return (
    <Tabs
      selectedKey={selected}
      onSelectionChange={(tab: ItemWindowTab) => {
        setChosen(tab);
        rememberItemWindowTab(tab);
      }}
    >
      <TabList label="Item">
        {available.map((tab) => (
          <Tab key={tab} id={tab}>
            {TAB_LABEL[tab]}
          </Tab>
        ))}
      </TabList>
      {available.map((tab) => (
        <TabPanel key={tab} id={tab}>
          {tab === "market" ? (
            marketTarget && <MarketPanel key={`${marketTarget.slug}-${String(marketTarget.rank)}`} target={marketTarget} onClose={closeItemWindow} />
          ) : info && info.byTab[tab].length === 0 && info.maxRank === 0 && !info.pending ? (
            <p className="text-sm text-muted">Nothing more is known about this item.</p>
          ) : (
            info && <ItemInfoTab data={info} tab={tab} />
          )}
        </TabPanel>
      ))}
    </Tabs>
  );
}

function Header({ info, name }: { info: ItemInfoData | null; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {info && <span className="text-muted">{info.kind}</span>}
      {info && info.owned !== null && <span className="tabular-nums">{info.owned > 0 ? `${fmt(info.owned)} owned` : "Not owned"}</span>}
      <Button size="sm" variant="ghost" leadingIcon={BookOpen} className="ms-auto" onClick={() => void openExternal(info?.wikiUrl ?? wikiUrl(name))}>
        Wiki
      </Button>
    </div>
  );
}

function CatalogItemBody({
  item,
  market,
  requested,
  extraSections,
}: {
  item: ItemInfoTarget;
  market: MarketTarget | null;
  requested: ItemWindowTab | null;
  extraSections: readonly InfoSection[];
}) {
  const info = useItemInfo(item, extraSections);
  return (
    <div className="flex flex-col gap-4">
      <Header info={info} name={item.name} />
      <SetPartStrip target={item} />
      <WindowTabs info={info} market={market} requested={requested} />
    </div>
  );
}

const NO_SECTIONS: readonly InfoSection[] = [];

/**
 * The one item window of the app, opened with `showItem`, `openItemInfo` or
 * `openItemWindow` (state/itemWindow). `extraSections` adds sections from
 * other screens, such as a prime set's selling value and relics.
 */
export function ItemWindowHost({ extraSections = NO_SECTIONS }: { extraSections?: readonly InfoSection[] | undefined }) {
  const request = useItemWindow();
  const { item, market } = useResolved(request);
  const baseUrl = useImageBaseUrl();
  const name = item?.name ?? market?.name ?? "";
  const imageName = item?.imageName ?? market?.imageName ?? null;
  return (
    <Modal
      open={request !== null}
      onClose={closeItemWindow}
      size="xl"
      placement="top"
      title={
        request && (
          <span className="flex items-center gap-2">
            <ItemImage size="sm" sources={imageSources(imageName ?? undefined, baseUrl)} name={name} />
            {name}
          </span>
        )
      }
    >
      {request &&
        (item ? (
          <CatalogItemBody
            key={`${item.uniqueName}-${market?.slug ?? ""}-${String(market?.rank ?? "")}`}
            item={item}
            market={market}
            requested={request.tab}
            extraSections={extraSections}
          />
        ) : (
          <div key={market?.slug} className="flex flex-col gap-4">
            <Header info={null} name={name} />
            <WindowTabs info={null} market={market} requested={request.tab} />
          </div>
        ))}
    </Modal>
  );
}
