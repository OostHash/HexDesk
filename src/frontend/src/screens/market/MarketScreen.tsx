import { useState } from "react";
import { useUnread } from "../../api/trading";
import { ScreenTabBar } from "../../patterns/ScreenTabBar";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/navigation";
import { openItemWindow } from "../../state/itemWindow";
import { ItemReport } from "./ItemReport";
import { TradeReport } from "./TradeReport";
import { TradingTab } from "./trading/TradingTab";

type MarketTab = "trading" | "trade-report" | "item-report";

/**
 * Market: Trading and the statistics on it (trade report, item report).
 * Prime Sets and Mods & Arcanes live under Inventory.
 */
export function MarketScreen() {
  const [tab, setTab] = useState<MarketTab>("trading");
  const unread = useUnread();

  return (
    <Tabs selectedKey={tab} onSelectionChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <ScreenTabBar>
        <TabList label="Market" className="border-b-0">
          <Tab id="trading">{unread > 0 ? `Trading (${String(unread)} new)` : "Trading"}</Tab>
          <Tab id="trade-report">Trade report</Tab>
          <Tab id="item-report">Item report</Tab>
        </TabList>
      </ScreenTabBar>
      <TabPanel id="trading" className="flex min-h-0 flex-1 flex-col">
        <TradingTab onEdit={openItemWindow} />
      </TabPanel>
      <TabPanel id="trade-report" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <TradeReport />
      </TabPanel>
      <TabPanel id="item-report" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <ItemReport />
      </TabPanel>
    </Tabs>
  );
}
