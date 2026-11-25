import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useSettings } from "../api/settings";
import { cn } from "../primitives/cn";
import { onOpenScreen } from "../state/navigation";
import { FoundryScreen } from "../screens/foundry/FoundryScreen";
import { SET_INFO_SECTIONS } from "../screens/inventory/SetParts";
import { ItemWindowHost } from "./ItemWindowHost";
import { MarketScreen } from "../screens/market/MarketScreen";
import { RivensScreen } from "../screens/rivens/RivensScreen";
import { SettingsScreen, type SettingsTab } from "../screens/settings/SettingsScreen";
import { InventoryScreen } from "../screens/inventory/InventoryScreen";
import { RelicsScreen } from "../screens/relics/RelicsScreen";
import { TimersScreen } from "../screens/timers/TimersScreen";
import { WelcomeScreen } from "../screens/settings/welcome/WelcomeScreen";
import { AppLifecycle } from "./AppLifecycle";
import { ChangeLogDock } from "./ChangeLogDock";
import { FissureAlerts } from "./FissureAlerts";
import { Header } from "./Header";
import { MainNav, type NavScreen } from "./MainNav";
import { ModularDock } from "./ModularDock";
import { NAV_ICONS } from "../patterns/navIcons";
import { RelicOverlayController } from "./RelicOverlayController";
import { TestReportNotices } from "./TestReportNotices";
import { ScreenBoundary } from "./ScreenBoundary";
import { TradeWatcher } from "./TradeWatcher";
import { WindowTitleBar } from "./WindowTitleBar";

type ScreenDef = NavScreen & { Screen: ComponentType };

/** The screens of the main window, in sidebar order. */
const SCREENS: readonly ScreenDef[] = [
  { id: "inventory", label: "Inventory", icon: NAV_ICONS.inventory, Screen: InventoryScreen },
  { id: "foundry", label: "Foundry", icon: NAV_ICONS.foundry, Screen: FoundryScreen },
  { id: "relics", label: "Relics", icon: NAV_ICONS.relics, Screen: RelicsScreen },
  { id: "rivens", label: "Rivens", icon: NAV_ICONS.rivens, Screen: RivensScreen },
  { id: "timers", label: "Timers", icon: NAV_ICONS.timers, Screen: TimersScreen },
  { id: "market", label: "Market", icon: NAV_ICONS.market, Screen: MarketScreen },
];

/** Main window: navigation on the left, the active screen on the right. */
export function AppShell() {
  const { data: settings, isPending: settingsPending } = useSettings();
  const [screen, setScreen] = useState("inventory");
  // Kept while the app runs, so Settings reopens on the category used last.
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const onSettings = screen === "settings";
  const current = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];
  // Stable: the changelog dock listens for the pop-out's requests with it.
  const openInventory = useCallback(() => {
    setScreen("inventory");
  }, []);
  useEffect(() => onOpenScreen(setScreen), []);
  const openSettings = (tab?: SettingsTab) => {
    if (tab) setSettingsTab(tab);
    setScreen("settings");
  };
  // Until settings load it is unknown whether this is a fresh install; showing
  // the app first would flash it before the welcome screen.
  if (settingsPending || settings?.onboardingCompleted === false) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <TestReportNotices />
        <WindowTitleBar />
        {!settingsPending && <WelcomeScreen />}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TestReportNotices />
      <AppLifecycle />
      <FissureAlerts />
      <TradeWatcher />
      <RelicOverlayController />
      <WindowTitleBar />
      <div className="flex min-h-0 flex-1">
        <MainNav
          screens={SCREENS}
          current={screen}
          onSelect={setScreen}
          settingsOpen={onSettings}
          onOpenSettings={() => {
            openSettings();
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onOpenScreen={setScreen}
            onOpenSettings={() => {
              // The memory scanner switch lives in General.
              openSettings("general");
            }}
          />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <h1 className="sr-only">{onSettings ? "Settings" : current?.label}</h1>
                {/* A screen keeps room for its toolbar and some of its list; in a lower window the panel scrolls as a whole. */}
                <div className="flex min-h-112 flex-1 flex-col">
                  {onSettings ? (
                    <ScreenBoundary key="settings" label="Settings">
                      <SettingsScreen tab={settingsTab} onTabChange={setSettingsTab} />
                    </ScreenBoundary>
                  ) : (
                    current && (
                      <ScreenBoundary key={current.id} label={current.label}>
                        <current.Screen />
                      </ScreenBoundary>
                    )
                  )}
                </div>
              </main>
              {/* Hidden, not unmounted, on Settings: the docks keep their state and their pop-out listeners. */}
              <div className={cn("contents", onSettings && "hidden")}>
                <ChangeLogDock onOpenInventory={openInventory} />
              </div>
            </div>
            <div className={cn("contents", onSettings && "hidden")}>
              <ModularDock />
            </div>
          </div>
        </div>
      </div>
      {/* Outside the screens: React Aria renders Tabs children in a detached collection pass, where showModal() fails. */}
      <ItemWindowHost extraSections={SET_INFO_SECTIONS} />
    </div>
  );
}
