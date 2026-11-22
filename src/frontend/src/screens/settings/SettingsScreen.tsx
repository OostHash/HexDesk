import { useId } from "react";
import { useAppVersion, usePendingUpdate } from "../../api/app";
import { HexDeskMark } from "../../patterns/HexDeskMark";
import { SidebarItem } from "../../primitives/navigation";
import { ConsoleTab } from "./ConsoleTab";
import { DataTab } from "./DataTab";
import { DebuggingTab } from "./DebuggingTab";
import { FiltersTab } from "./FiltersTab";
import { GeneralTab } from "./GeneralTab";
import { MarketTab } from "./MarketTab";
import { OverlaysTab } from "./OverlaysTab";

/** Every category, in navigator order. `devOnly` ones are left out of release builds. */
export const SETTINGS_TABS = [
  { id: "general", label: "General", Panel: GeneralTab },
  { id: "overlays", label: "Overlays", Panel: OverlaysTab },
  { id: "market", label: "Market", Panel: MarketTab },
  { id: "filters", label: "Filters", Panel: FiltersTab },
  { id: "data", label: "Data", Panel: DataTab },
  { id: "debugging", label: "Debugging", Panel: DebuggingTab, devOnly: true },
  { id: "console", label: "Console", Panel: ConsoleTab },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

// Debugging holds developer pages; release builds export diagnostics from the console instead.
const VISIBLE_TABS = SETTINGS_TABS.filter((t) => !("devOnly" in t) || import.meta.env.DEV);

type Props = {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
};

/**
 * Settings as a screen: the categories in a navigator column, like the
 * Inventory and Foundry navigators, and the chosen category beside it. The
 * logo and app version sit at the bottom of the navigator.
 */
export function SettingsScreen({ tab, onTabChange }: Props) {
  const version = useAppVersion();
  const update = usePendingUpdate();
  const headingId = useId();
  const current = VISIBLE_TABS.find((t) => t.id === tab) ?? SETTINGS_TABS[0];
  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Settings" className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border p-2">
        <ul className="flex flex-col gap-0.5">
          {VISIBLE_TABS.map((t) => (
            <li key={t.id}>
              <SidebarItem
                active={t.id === current.id}
                label={t.label}
                // General holds the Updates group: point there while an update waits.
                {...(update && t.id === "general"
                  ? {
                      "aria-label": `${t.label}, update available`,
                      badge: <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />,
                    }
                  : {})}
                onClick={() => {
                  onTabChange(t.id);
                }}
              />
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-2.5 border-t border-border px-3 pt-3 pb-1 text-text">
          <HexDeskMark className="size-8" />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold">HexDesk</span>
            <span className="text-sm tabular-nums">{version ? `Version ${version}` : "Version unknown"}</span>
          </div>
        </div>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {/* One column for every category, capped so labels stay within reach of their controls on wide windows. */}
        <section aria-labelledby={headingId} className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-5">
          <h2 id={headingId} className="text-lg font-semibold">
            {current.label}
          </h2>
          <current.Panel key={current.id} />
        </section>
      </div>
    </div>
  );
}
