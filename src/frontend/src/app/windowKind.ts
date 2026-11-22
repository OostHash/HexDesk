import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../api/env";

export type WindowKind = "main" | "overlay" | "modular" | "changelog" | "riven-overlay" | "relic-pick-overlay" | "overlay-status";

const BY_MARKER: ReadonlyArray<readonly [string, WindowKind]> = [
  ["overlay", "overlay"],
  ["modular", "modular"],
  ["changelog", "changelog"],
  ["rivenoverlay", "riven-overlay"],
  ["relicpickoverlay", "relic-pick-overlay"],
  ["overlaystatus", "overlay-status"],
];

const BY_LABEL: Readonly<Record<string, WindowKind>> = {
  overlay: "overlay",
  modular: "modular",
  "changelog-popout": "changelog",
  "riven-overlay": "riven-overlay",
  "relic-pick-overlay": "relic-pick-overlay",
  "overlay-status": "overlay-status",
};

/**
 * Decides which window this bundle renders. Tauri is only touched inside the
 * function, never at module level, so the app also loads in a plain browser.
 */
export function resolveWindowKind(location: Pick<Location, "search" | "hash"> = window.location): WindowKind {
  const params = new URLSearchParams(location.search);
  for (const [marker, kind] of BY_MARKER) {
    if (params.has(marker) || location.hash === `#${marker}`) return kind;
  }
  if (isTauri()) {
    const kind = BY_LABEL[getCurrentWindow().label];
    if (kind) return kind;
  }
  return "main";
}
