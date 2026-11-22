/**
 * Filter presets shared by Inventory, Relics, Foundry and Market. Stored in
 * the settings file as `filterPresets`; the format is kept stable so saved
 * presets keep working. Presets of modules this app does not edit are
 * kept untouched: a save never drops them.
 */

export type PresetModule = "inventory" | "foundry" | "market" | "relics";

export type StoredPreset = {
  id: string;
  name: string;
  module: PresetModule;
  createdAt: number;
  pinned?: boolean;
  color?: string;
  dividerAfter?: boolean;
  /** Module-specific, in the stored format. */
  filters: unknown;
};

export type PresetSettings = {
  presets: StoredPreset[];
  restorePreviousFiltersOnPresetClick: boolean;
};

/** Converts a screen's filters to and from the stored format. */
export type PresetCodec<F> = {
  module: PresetModule;
  /** null when the stored filters are invalid for this module. */
  decode: (stored: unknown) => F | null;
  encode: (filters: F) => unknown;
};

const MODULES: readonly PresetModule[] = ["inventory", "foundry", "market", "relics"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parsePreset(v: unknown): StoredPreset | null {
  if (!isRecord(v)) return null;
  const { id, name, module, createdAt, pinned, color, dividerAfter, filters } = v;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) return null;
  if (typeof module !== "string" || !(MODULES as readonly string[]).includes(module)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt < 0) return null;
  return {
    id,
    name: name.trim(),
    module: module as PresetModule,
    createdAt,
    ...(typeof pinned === "boolean" ? { pinned } : {}),
    ...(typeof color === "string" && color ? { color } : {}),
    ...(typeof dividerAfter === "boolean" ? { dividerAfter } : {}),
    filters,
  };
}

export function parsePresetSettings(value: unknown): PresetSettings {
  if (!isRecord(value)) return { presets: [], restorePreviousFiltersOnPresetClick: false };
  return {
    presets: Array.isArray(value.presets) ? value.presets.map(parsePreset).filter((p): p is StoredPreset => p !== null) : [],
    restorePreviousFiltersOnPresetClick: value.restorePreviousFiltersOnPresetClick === true,
  };
}

export type Preset<F> = StoredPreset & { decoded: F };

/** Presets of one module whose filters decode, in stored order. */
export function modulePresets<F>(settings: PresetSettings, codec: PresetCodec<F>): Array<Preset<F>> {
  const out: Array<Preset<F>> = [];
  for (const preset of settings.presets) {
    if (preset.module !== codec.module) continue;
    const decoded = codec.decode(preset.filters);
    if (decoded !== null) out.push({ ...preset, decoded });
  }
  return out;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) => (isRecord(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

export function sameFilters<F>(codec: PresetCodec<F>, a: F, b: F): boolean {
  return stable(codec.encode(a)) === stable(codec.encode(b));
}

export function isPresetActive<F>(preset: Preset<F>, current: F, codec: PresetCodec<F>): boolean {
  return sameFilters(codec, preset.decoded, current);
}

// ── Edits (pure; return the new settings) ───────────────────────────────────

export function addPreset<F>(settings: PresetSettings, codec: PresetCodec<F>, name: string, filters: F, now: number): PresetSettings {
  const preset: StoredPreset = {
    id: `${codec.module}-${String(now)}`,
    name: name.trim(),
    module: codec.module,
    createdAt: now,
    filters: codec.encode(filters),
  };
  return { ...settings, presets: [...settings.presets, preset] };
}

const update = (settings: PresetSettings, id: string, change: (p: StoredPreset) => StoredPreset | null): PresetSettings => ({
  ...settings,
  presets: settings.presets.flatMap((p) => {
    if (p.id !== id) return [p];
    const next = change(p);
    return next ? [next] : [];
  }),
});

export const renamePreset = (s: PresetSettings, id: string, name: string) => update(s, id, (p) => ({ ...p, name: name.trim() }));
export const togglePin = (s: PresetSettings, id: string) => update(s, id, (p) => ({ ...p, pinned: !p.pinned }));
export const removePreset = (s: PresetSettings, id: string) => update(s, id, () => null);

/**
 * Moves a preset one place up or down among presets of the same module and
 * pin state (the keyboard alternative to dragging).
 */
export function movePreset(settings: PresetSettings, id: string, direction: -1 | 1): PresetSettings {
  const target = settings.presets.find((p) => p.id === id);
  if (!target) return settings;
  const group = settings.presets
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.module === target.module && Boolean(p.pinned) === Boolean(target.pinned));
  const pos = group.findIndex(({ p }) => p.id === id);
  const swap = group[pos + direction];
  const self = group[pos];
  if (!swap || !self) return settings;
  const presets = [...settings.presets];
  presets[self.i] = swap.p;
  presets[swap.i] = self.p;
  return { ...settings, presets };
}
