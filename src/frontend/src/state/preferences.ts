import { useSyncExternalStore } from "react";
import {
  PREFERENCE_KEYS,
  clampTextScale,
  isOverlayLocation,
  parsePreferences,
  resolveAttributes,
  type MediaState,
  type Preferences,
} from "./preferenceSchema";

export * from "./preferenceSchema";

// ── Store ──────────────────────────────────────────────────────────────────

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";

const readMedia = (): MediaState => ({
  prefersDark: window.matchMedia(DARK_QUERY).matches,
  prefersMoreContrast: window.matchMedia(CONTRAST_QUERY).matches,
});

let current: Preferences = parsePreferences((key) => localStorage.getItem(key));
const listeners = new Set<() => void>();

function applyToRoot(prefs: Preferences) {
  const attrs = resolveAttributes(prefs, readMedia(), isOverlayLocation(window.location));
  for (const [name, value] of Object.entries(attrs)) {
    document.documentElement.setAttribute(name, value);
  }
}

function emit() {
  applyToRoot(current);
  for (const listener of listeners) listener();
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(patch: Partial<Preferences>) {
  current = { ...current, ...patch };
  current.textScale = clampTextScale(current.textScale);
  localStorage.setItem(PREFERENCE_KEYS.theme, current.theme);
  localStorage.setItem(PREFERENCE_KEYS.contrast, current.contrast);
  localStorage.setItem(PREFERENCE_KEYS.cvd, String(current.cvd));
  localStorage.setItem(PREFERENCE_KEYS.density, current.density);
  localStorage.setItem(PREFERENCE_KEYS.textScale, String(current.textScale));
  localStorage.setItem(PREFERENCE_KEYS.overlayTheme, current.overlayTheme);
  localStorage.setItem(PREFERENCE_KEYS.accent, current.accent);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Starts following OS theme/contrast changes and other windows' writes.
 * Call once per window (app/providers). Returns a cleanup.
 */
export function startPreferenceSync(): () => void {
  const queries = [window.matchMedia(DARK_QUERY), window.matchMedia(CONTRAST_QUERY)];
  const onMedia = () => {
    emit();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || (Object.values(PREFERENCE_KEYS) as string[]).includes(event.key)) {
      current = parsePreferences((key) => localStorage.getItem(key));
      emit();
    }
  };
  for (const query of queries) query.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  applyToRoot(current);
  return () => {
    for (const query of queries) query.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences);
}
