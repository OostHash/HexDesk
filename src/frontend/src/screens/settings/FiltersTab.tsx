import { useState } from "react";
import { usePresetManager } from "../../api/presets";
import type { PresetModule } from "../../domain/filterPresets";
import {
  DUCAT_TIERS,
  RECENT_WINDOW_LABEL,
  RECENT_WINDOWS,
  recentWindowFrom,
  SELL_FROM_RANGE,
  sellFromPrice,
  sellFromSetting,
  type DucatTier,
} from "../../domain/inventory";
import { PresetList } from "../../patterns/PresetBar";
import { FormField, Input, Select } from "../../primitives/forms";
import { SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

const PAGES: ReadonlyArray<{ value: PresetModule; label: string }> = [
  { value: "inventory", label: "Inventory" },
  { value: "foundry", label: "Foundry" },
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

function SellFromField({ tier, value, onCommit }: { tier: DucatTier; value: number; onCommit: (price: number) => void }) {
  // The parent keys this field by value, so a saved value resets the draft.
  const [draft, setDraft] = useState(String(value));
  return (
    <FormField layout="row" label={`${String(tier)} ducats`}>
      <span className="flex items-center gap-2 text-xs text-muted">
        Sell from
        <Input
          type="number"
          size="sm"
          className="w-20 text-end tabular-nums"
          aria-label={`Sell ${String(tier)}-ducat parts from, in platinum`}
          min={SELL_FROM_RANGE.min}
          max={SELL_FROM_RANGE.max}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={() => {
            const price = sellFromPrice(draft, value);
            setDraft(String(price));
            if (price !== value) onCommit(price);
          }}
        />
        platinum
      </span>
    </FormField>
  );
}

/** Per ducat value, from which price Prime Sets marks a part as better sold than traded for ducats. */
function SellFromGroup() {
  const { settings, set } = useSettingsFile();
  const table = sellFromSetting(settings.sellFrom);
  return (
    <SettingsGroup title="Ducats or platinum">
      <p className="px-1 text-xs text-muted">
        Prime Sets marks a part's price when it sells for at least this much, and its ducats when it sells for less: then Baro Ki'Teer is the better
        deal.
      </p>
      {DUCAT_TIERS.map((tier) => (
        <SellFromField
          key={`${String(tier)}-${String(table[tier])}`}
          tier={tier}
          value={table[tier]}
          onCommit={(price) => {
            set({ sellFrom: { ...table, [tier]: price } });
          }}
        />
      ))}
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
      <SellFromGroup />
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
