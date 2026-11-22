import { useState } from "react";
import { useOwnership } from "../../api/inventory";
import { useCatalogIndex, usePlatPrices } from "../../api/relics";
import { ScreenTabBar } from "../../patterns/ScreenTabBar";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/navigation";
import { PlannerTab } from "./PlannerTab";
import { RelicsTab } from "./RelicsTab";

/** Relics: owned relics with their rewards, and the refinement planner. */
export function RelicsScreen() {
  const [tab, setTab] = useState<"relics" | "planner">("relics");
  const { ownership } = useOwnership();
  const { index } = useCatalogIndex();
  const prices = usePlatPrices();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs selectedKey={tab} onSelectionChange={setTab} className="min-h-0 flex-1 gap-0">
        <ScreenTabBar>
          <TabList label="Relics" className="border-b-0">
            <Tab id="relics">Relics</Tab>
            <Tab id="planner">Planner</Tab>
          </TabList>
        </ScreenTabBar>
        {/* Each tab scrolls on its own, under the tab bar. */}
        <TabPanel id="relics" className="flex min-h-0 flex-1 flex-col">
          <RelicsTab index={index} own={ownership} prices={prices} />
        </TabPanel>
        <TabPanel id="planner" className="flex min-h-0 flex-1 flex-col">
          <PlannerTab index={index} own={ownership} prices={prices} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
