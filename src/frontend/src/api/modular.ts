import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { watchesFrom, type FissureWatch } from "../domain/fissures";
import { idListFrom, modularWidthFrom, POPOUT_SIZE, sectionOrderFrom, type SectionId } from "../domain/modular";
import { normalizeFavorites, type TimerId } from "../domain/timers";
import { invoke } from "./invoke";
import { useSaveSettings, useSettings, type SettingsFile } from "./settings";

/** Label and route of the pop-out window (capabilities list the label). */
export const POPOUT_LABEL = "modular-popout";
const POPOUT_URL = "index.html#modular";

export type ModularPrefs = {
  tracked: string[];
  favorites: string[];
  timerFavorites: TimerId[];
  watches: FissureWatch[];
  sectionOrder: SectionId[];
  width: number;
  collapsed: boolean;
  popout: boolean;
};

export function modularPrefsFrom(settings: SettingsFile | undefined): ModularPrefs {
  const s = settings ?? {};
  return {
    tracked: idListFrom(s.tracked),
    favorites: idListFrom(s.favorites),
    timerFavorites: normalizeFavorites(idListFrom(s.timerFavorites)),
    watches: watchesFrom(s.fissureWatches),
    sectionOrder: sectionOrderFrom(s.modularSectionOrder),
    width: modularWidthFrom(s.modularWidth),
    collapsed: s.modularCollapsed === true,
    popout: s.modularPopout === true,
  };
}

/** Modular window settings plus a setter per list (shared settings file). */
export function useModularPrefs() {
  const { data, isSuccess } = useSettings();
  const { mutate, mutateAsync } = useSaveSettings();
  return {
    prefs: modularPrefsFrom(data),
    /** Saving before the file is read would clobber it (the backend merges keys, but a list replaces). */
    loaded: isSuccess,
    setTracked: (tracked: string[]) => {
      mutate({ tracked });
    },
    setFavorites: (favorites: string[]) => {
      mutate({ favorites });
    },
    setTimerFavorites: (timerFavorites: TimerId[]) => {
      mutate({ timerFavorites });
    },
    setSectionOrder: (modularSectionOrder: SectionId[]) => {
      mutate({ modularSectionOrder });
    },
    setWidth: (modularWidth: number) => {
      return mutateAsync({ modularWidth });
    },
    setCollapsed: (modularCollapsed: boolean) => {
      mutate({ modularCollapsed });
    },
    setPopout: (modularPopout: boolean) => {
      mutate({ modularPopout });
    },
  };
}

type Geometry = { x: number | undefined; y: number | undefined; w: number | undefined; h: number | undefined };

const geometryFrom = (s: SettingsFile | undefined): Geometry => {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { x: n(s?.modularWinX), y: n(s?.modularWinY), w: n(s?.modularWinWidth), h: n(s?.modularWinHeight) };
};

/** True when the saved corner lies on a connected monitor. */
async function onAMonitor(x: number, y: number): Promise<boolean> {
  const monitors = await availableMonitors().catch(() => []);
  return monitors.some((m) => x >= m.position.x && x < m.position.x + m.size.width && y >= m.position.y && y < m.position.y + m.size.height);
}

/**
 * Opens the pop-out at its saved place (only when that is on screen) and
 * calls onClosed when the user closes it. Does nothing when it is open.
 */
export async function openModularPopout(settings: SettingsFile | undefined, dockedWidth: number, onClosed: () => void): Promise<void> {
  if (await WebviewWindow.getByLabel(POPOUT_LABEL)) return;
  const g = geometryFrom(settings);
  const position = g.x !== undefined && g.y !== undefined && (await onAMonitor(g.x, g.y)) ? { x: g.x, y: g.y } : {};
  const win = new WebviewWindow(POPOUT_LABEL, {
    url: POPOUT_URL,
    title: "HexDesk — Modular Window",
    width: g.w ?? dockedWidth,
    height: g.h ?? POPOUT_SIZE.height,
    ...position,
    minWidth: POPOUT_SIZE.minWidth,
    minHeight: POPOUT_SIZE.minHeight,
    resizable: true,
  });
  void win.once("tauri://destroyed", onClosed);
}

export async function closeModularPopout(): Promise<void> {
  const win = await WebviewWindow.getByLabel(POPOUT_LABEL);
  await win?.close();
}

/** Saves the pop-out's own position and size, in physical pixels (inside the pop-out). */
export async function savePopoutGeometry(): Promise<void> {
  const win = getCurrentWindow();
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  await invoke("save_settings", {
    json: JSON.stringify({ modularWinX: position.x, modularWinY: position.y, modularWinWidth: size.width, modularWinHeight: size.height }),
  });
}
