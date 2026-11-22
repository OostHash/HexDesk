import { useState } from "react";
import { usePresetManager } from "../../api/presets";
import type { PresetModule } from "../../domain/filterPresets";
import { RECENT_WINDOW_LABEL, RECENT_WINDOWS, recentWindowFrom } from "../../domain/inventory";
import { PresetList } from "../../patterns/PresetBar";
import { FormField, Select } from "../../primitives/forms";
import { SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

const PAGES: ReadonlyArray<{ value: PresetModule; label: string }> = [
  { value: "inventory", label: "Inventory" },
  { value: "foundry", label: "Foundry" },
  { value: "market", label: "Market Sets" },
  { value: "relics", label: "Relic browser" },
];

/** What "Changed recently" covers in Inventory: the filter, the recent sort and the change badges. */
function RecentWindowGroup() {
  const { settings, set } = useSettingsFile();
  return (
    <SettingsGroup title="Changed recently">
      <FormField
        layout="row"
        label="Counts changes from"
        description="Used by the Changed recently filter and sort in Inventory, and by the change badge on items."
      >
        <Select
          className="w-56"
          value={recentWindowFrom(settings.recentWindow)}
          onChange={(event) => {
            set({ recentWindow: event.target.value });
          }}
        >
          {RECENT_WINDOWS.map((value) => (
            <option key={value} value={value}>
              {RECENT_WINDOW_LABEL[value]}
            </option>
          ))}
        </Select>
      </FormField>
    </SettingsGroup>
  );
}

export function FiltersTab() {
  const [page, setPage] = useState<PresetModule>("inventory");
  const manager = usePresetManager(page);
  const pageLabel = PAGES.find((p) => p.value === page)?.label ?? page;
  return (
    <>
      <RecentWindowGroup />
      <SettingsGroup title="Filter presets">
        <SwitchRow
          label="Restore previous filters on active preset click"
          description="Clicking an active pinned preset again restores the filters from before it, instead of clearing them."
          checked={manager.restorePrevious}
          onCheckedChange={manager.setRestorePrevious}
        />
        <FormField layout="row" label="Page" description="Manage saved and pinned presets for one page.">
          <Select
            className="w-48"
            value={page}
            onChange={(event) => {
              setPage(event.target.value as PresetModule);
            }}
          >
            {PAGES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </FormField>
      </SettingsGroup>
      <SettingsGroup title={`${pageLabel} presets`}>
        <div>
          <PresetList model={manager} />
        </div>
      </SettingsGroup>
    </>
  );
}
