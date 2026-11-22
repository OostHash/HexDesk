import { useState } from "react";
import { DEFAULT_MARKET_FILTERS, type MarketFilters } from "../../domain/market";
import { ScreenTabBar } from "../../patterns/ScreenTabBar";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/navigation";
import { useInventoryFilters } from "../../state/inventoryFilters";
import { openItemWindow } from "../../state/itemWindow";
import { ItemsTab } from "./ItemsTab";
import { ModsTab } from "./ModsTab";
import { SetsTab } from "./SetsTab";

type InventoryTab = "items" | "sets" | "mods";

/** Inventory: your items by category, prime sets and mods & arcanes (these open the market item window). */
export function InventoryScreen() {
  const [tab, setTab] = useState<InventoryTab>("items");
  const [setFilters, setSetFilters] = useState<MarketFilters>({ ...DEFAULT_MARKET_FILTERS, activeMarketTab: "sets" });

  // The changelog dock opens Inventory on an item by setting the item filters:
  // show the Items tab then, also when Prime Sets or Mods was open.
  const [itemFilters] = useInventoryFilters();
  const [seenFilters, setSeenFilters] = useState(itemFilters);
  if (seenFilters !== itemFilters) {
    setSeenFilters(itemFilters);
    setTab("items");
  }

  return (
    <Tabs selectedKey={tab} onSelectionChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <ScreenTabBar>
        <TabList label="Inventory" className="border-b-0">
          <Tab id="items">Items</Tab>
          <Tab id="sets">Prime Sets</Tab>
          <Tab id="mods">Mods &amp; Arcanes</Tab>
        </TabList>
      </ScreenTabBar>
      <TabPanel id="items" className="flex min-h-0 flex-1 flex-col">
        <ItemsTab />
      </TabPanel>
      <TabPanel id="sets" className="flex min-h-0 flex-1 flex-col">
        <SetsTab filters={setFilters} setFilters={setSetFilters} onOpen={openItemWindow} />
      </TabPanel>
      <TabPanel id="mods" className="flex min-h-0 flex-1 flex-col">
        <ModsTab onOpen={openItemWindow} />
      </TabPanel>
    </Tabs>
  );
}
