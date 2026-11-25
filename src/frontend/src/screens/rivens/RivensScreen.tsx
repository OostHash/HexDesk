import { useEffect, useState } from "react";
import { ScreenTabBar } from "../../patterns/ScreenTabBar";
import { clearRivenFocus, useRivenFocus } from "../../state/navigation";
import { Tab, TabList, TabPanel, Tabs } from "../../primitives/navigation";
import { AnalyzerTab } from "./AnalyzerTab";
import { MyRivensTab } from "./MyRivensTab";

type View = "analyzer" | "owned";

/** Rivens: the analyzer and the rivens you own. */
export function RivensScreen() {
  // Another screen can open a riven (src/frontend/src/state/navigation.ts): show it on My rivens.
  const focus = useRivenFocus();
  const [view, setView] = useState<View>(focus ? "owned" : "analyzer");
  const [focusId, setFocusId] = useState(focus);
  if (focus !== null && focus !== focusId) {
    setFocusId(focus);
    setView("owned");
  }
  // Taken once: coming back to Rivens later opens it as usual.
  useEffect(() => {
    if (focus !== null) clearRivenFocus();
  }, [focus]);
  return (
    <Tabs selectedKey={view} onSelectionChange={setView} className="flex min-h-0 flex-1 flex-col gap-0">
      <ScreenTabBar>
        <TabList label="Rivens" className="border-b-0">
          <Tab id="analyzer">Analyzer</Tab>
          <Tab id="owned">My rivens</Tab>
        </TabList>
      </ScreenTabBar>
      <TabPanel id="analyzer" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <AnalyzerTab />
      </TabPanel>
      <TabPanel id="owned" className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <MyRivensTab focusId={focusId} />
      </TabPanel>
    </Tabs>
  );
}
