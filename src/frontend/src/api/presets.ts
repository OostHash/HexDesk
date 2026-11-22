import { useState } from "react";
import {
  addPreset,
  isPresetActive,
  modulePresets,
  movePreset,
  parsePresetSettings,
  removePreset,
  renamePreset,
  sameFilters,
  togglePin,
  type PresetCodec,
  type PresetModule,
  type PresetSettings,
} from "../domain/filterPresets";
import { useSaveSettings, useSettings } from "./settings";

/**
 * Filter presets of one screen, stored in the shared settings file
 * (`filterPresets`). Clicking an active preset again turns it off: it
 * restores the filters from before it when the user enabled that option,
 * and clears the filters otherwise.
 */
export function useFilterPresets<F>(codec: PresetCodec<F>, filters: F, setFilters: (f: F) => void, defaults: F) {
  const { data } = useSettings();
  const save = useSaveSettings();
  const settings = parsePresetSettings(data?.filterPresets);
  const presets = modulePresets(settings, codec);
  const [beforePreset, setBeforePreset] = useState<F | null>(null);
  const [beforeClear, setBeforeClear] = useState<F | null>(null);

  const write = (next: PresetSettings) => {
    save.mutate({ filterPresets: next });
  };
  const isActive = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    return preset ? isPresetActive(preset, filters, codec) : false;
  };
  const isDefault = sameFilters(codec, filters, defaults);

  return {
    presets,
    isActive,
    apply: (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      // A second click always turns the preset off: back to the filters from
      // before it when the user asked for that and they are known, else cleared.
      if (isPresetActive(preset, filters, codec)) {
        setFilters(settings.restorePreviousFiltersOnPresetClick && beforePreset ? beforePreset : defaults);
        setBeforePreset(null);
        return;
      }
      setBeforePreset(filters);
      setFilters(preset.decoded);
    },
    saveCurrent: (name: string) => {
      write(addPreset(settings, codec, name, filters, Date.now()));
    },
    rename: (id: string, name: string) => {
      write(renamePreset(settings, id, name));
    },
    togglePin: (id: string) => {
      write(togglePin(settings, id));
    },
    move: (id: string, direction: -1 | 1) => {
      write(movePreset(settings, id, direction));
    },
    remove: (id: string) => {
      write(removePreset(settings, id));
    },
    /** "Clear filters", or "Restore filters" right after a clear. */
    clear: {
      label: beforeClear ? "Restore filters" : "Clear filters",
      disabled: isDefault && !beforeClear,
      run: () => {
        if (beforeClear) {
          setFilters(beforeClear);
          setBeforeClear(null);
        } else {
          setBeforeClear(filters);
          setFilters(defaults);
        }
      },
    },
  };
}

export type FilterPresetsApi = ReturnType<typeof useFilterPresets>;

/**
 * Managing one module's presets without its filters (Settings → Filters).
 * Presets are listed as stored, so ones the module cannot decode can still
 * be renamed or deleted.
 */
export function usePresetManager(module: PresetModule) {
  const { data } = useSettings();
  const save = useSaveSettings();
  const settings = parsePresetSettings(data?.filterPresets);
  const write = (next: PresetSettings) => {
    save.mutate({ filterPresets: next });
  };
  return {
    presets: settings.presets.filter((p) => p.module === module),
    restorePrevious: settings.restorePreviousFiltersOnPresetClick,
    setRestorePrevious: (on: boolean) => {
      write({ ...settings, restorePreviousFiltersOnPresetClick: on });
    },
    rename: (id: string, name: string) => {
      write(renamePreset(settings, id, name));
    },
    togglePin: (id: string) => {
      write(togglePin(settings, id));
    },
    move: (id: string, direction: -1 | 1) => {
      write(movePreset(settings, id, direction));
    },
    remove: (id: string) => {
      write(removePreset(settings, id));
    },
  };
}
