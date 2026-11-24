import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { currentMonitor, getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { emitEvent } from "./events";
import { invoke } from "./invoke";
import { useSettings, type SettingsFile } from "./settings";
import { overlayPriorityFrom, stripBounds, type BackendCard, type OverlayPriority } from "../domain/relicReward";
import { overlayKeyCode, overlayKeyFrom, testingKeysFrom, type OverlayKey, type TestingKeys } from "../domain/overlayKey";
import { pickLinesFrom, pickPriorityFrom, type PickLines, type PickPriority } from "../domain/relicPick";
import { offsetsFrom, type OverlayOffsets } from "../domain/overlayOffsets";
import { overlayStatusFrom, type OverlayStatusSettings } from "../domain/overlayStatus";
import { useCrafting, useQuantities } from "./inventory";

/** Overlay switches and choices from the shared settings file. */
export type OverlayPrefs = {
  /** All overlays (default on). */
  overlaysEnabled: boolean;
  /** The relic reward overlay (default on). */
  rewardEnabled: boolean;
  rewardPriority: OverlayPriority;
  /** The relic pick overlay (default on). */
  relicPickEnabled: boolean;
  pickPriority: PickPriority;
  pickLines: PickLines;
  /** The key that shows or hides the overlays (default Home). */
  overlayKey: OverlayKey;
  /** Only the overlay key opens an overlay; the game's log still closes one (default off). */
  overlayManual: boolean;
  /** The keys that answer the testing prompt (default Page Up and Page Down). */
  testingKeys: TestingKeys;
  /** Save what OCR reads on screen (default off). */
  overlayKeyCapture: boolean;
  /** Save the game frame with the areas each read uses outlined (default off). */
  overlayAreas: boolean;
  /** Save the overlay window each time it is drawn (default off). */
  overlayScreenshot: boolean;
  /** The riven overlay (default on). */
  rivenEnabled: boolean;
  status: OverlayStatusSettings;
  offsets: OverlayOffsets;
};

export function overlayPrefsFrom(s: SettingsFile | undefined): OverlayPrefs {
  return {
    overlaysEnabled: s?.overlaysEnabled !== false,
    rewardEnabled: s?.overlayEnabled !== false,
    rewardPriority: overlayPriorityFrom(s?.overlayPriority),
    relicPickEnabled: s?.relicPickEnabled !== false,
    pickPriority: pickPriorityFrom(s?.relicPickPriority),
    pickLines: pickLinesFrom(s?.relicPickLines),
    overlayKey: overlayKeyFrom(s?.overlayKey),
    overlayManual: s?.overlayManual === true,
    testingKeys: testingKeysFrom(s?.testingCorrectKey, s?.testingWrongKey),
    overlayKeyCapture: s?.overlayKeyCapture === true,
    overlayScreenshot: s?.overlayScreenshot === true,
    overlayAreas: s?.overlayAreas === true,
    rivenEnabled: s?.rivenEnabled !== false,
    status: overlayStatusFrom(s?.overlayStatus),
    offsets: offsetsFrom(s?.overlayOffsets),
  };
}

export function useOverlayPrefs(): OverlayPrefs {
  return overlayPrefsFrom(useSettings().data);
}

/** Tells the backend which overlay triggers may run (at start and on every change). */
export async function syncOverlaySwitches(prefs: OverlayPrefs): Promise<void> {
  await Promise.all([
    invoke("set_overlays_enabled", { enabled: prefs.overlaysEnabled }),
    invoke("set_relic_pick_enabled", { enabled: prefs.relicPickEnabled }),
    invoke("set_relic_reward_enabled", { enabled: prefs.rewardEnabled }),
    invoke("set_riven_enabled", { enabled: prefs.rivenEnabled }),
    invoke("set_overlay_manual", { enabled: prefs.overlayManual }),
    invoke("set_overlay_key", { vk: overlayKeyCode(prefs.overlayKey) }),
    invoke("set_testing_keys", { correct: overlayKeyCode(prefs.testingKeys.correct), wrong: overlayKeyCode(prefs.testingKeys.wrong) }),
    invoke("set_overlay_key_capture", { enabled: prefs.overlayKeyCapture }),
    invoke("set_overlay_screenshot", { enabled: prefs.overlayScreenshot }),
    invoke("set_overlay_areas", { enabled: prefs.overlayAreas }),
  ]);
  if (!prefs.overlaysEnabled) await emitEvent("overlays-disabled");
}

/** A line from an overlay window in the log (Settings → Console), for bug reports. */
export const logRelic = (msg: string) => invoke("log_relic_fe", { msg }).catch(() => null);

/** The game's client area, or the first screen when the game is not found (`log` hears which). */
export async function gameRect(log?: (msg: string) => void): Promise<[number, number, number, number]> {
  try {
    const rect = await invoke("get_warframe_window_rect");
    log?.(`wf(${String(rect[0])},${String(rect[1])} ${String(rect[2])}×${String(rect[3])})`);
    return rect;
  } catch (error) {
    // window.screen is in CSS px; the backend wants physical px.
    const ratio = window.devicePixelRatio || 1;
    log?.(`wf-rect failed (${String(error)}), using screen dims`);
    return [0, 0, Math.round(window.screen.width * ratio), Math.round(window.screen.height * ratio)];
  }
}

/** Places the reward strip over the game; `isCurrent` lets a newer action cancel this one. */
export async function showRewardStrip(
  strip: { top: number; height: number },
  scale: number,
  isCurrent: () => boolean,
  label = "preview",
): Promise<boolean> {
  const rect = await gameRect((msg) => void logRelic(`[APP] ${label}: ${msg}`));
  if (!isCurrent()) return false;
  await invoke("show_overlay_window", stripBounds(rect, strip, scale));
  if (isCurrent()) return true;
  await hideRewardStrip();
  return false;
}

export const hideRewardStrip = () => invoke("move_overlay_offscreen").catch(() => null);

/** Settings → Overlays → Show: place the strip and draw the example cards. */
export async function showRewardPreview(scale: number): Promise<void> {
  await showRewardStrip({ top: 0.6, height: 0.3 }, scale, () => true);
  await emitEvent("relic-reward-preview");
}

export async function hideRewardPreview(): Promise<void> {
  await emitEvent("relic-reward-preview-close");
}

// ── Backend status line (status-line) ─────────────────────────────────────────

const statusKey = ["overlay", "status"] as const;

/** Latest backend status line, or "" (shown as a header chip for a few seconds). */
export const useOverlayStatus = () => useQuery({ queryKey: statusKey, queryFn: () => "", staleTime: Infinity, gcTime: Infinity }).data ?? "";

export function setOverlayStatus(queryClient: QueryClient, text: string) {
  queryClient.setQueryData(statusKey, text);
}

// ── Reward overlay data ─────────────────────────────────────────────────────

const NO_CARDS: readonly BackendCard[] = [];

/**
 * The backend's cards for this session's rewards: set parts and what the
 * player owns of them. Asked again when the inventory changes.
 */
export function useRewardCards(paths: readonly string[]): readonly BackendCard[] {
  const inventoryAt = useQuantities().dataUpdatedAt;
  const crafting = useCrafting().length;
  return (
    useQuery({
      queryKey: ["overlay", "reward-cards", paths, inventoryAt, crafting] as const,
      queryFn: () => invoke("get_reward_cards", { paths: [...paths] }),
      enabled: paths.length > 0,
    }).data ?? NO_CARDS
  );
}

/** Cached warframe.market prices by item name; names without a price are left out. */
export function useItemPrices(names: readonly string[]): ReadonlyMap<string, number> {
  return useQueries({
    queries: names.map((itemName) => ({
      queryKey: ["overlay", "price", itemName] as const,
      queryFn: () => invoke("get_item_price", { itemName }),
      staleTime: 5 * 60_000,
    })),
    combine: (results) =>
      new Map(
        names.flatMap((name, i) => {
          const value = results[i]?.data;
          return typeof value === "number" ? [[name, value] as const] : [];
        }),
      ),
  });
}

export const takePendingRewards = () => invoke("get_pending_relic_rewards").catch(() => null);

// ── Relic pick window ───────────────────────────────────────────────────────

/** Settings → Overlays → Show: the example relics in the backend-placed window. */
export async function showPickPreview(): Promise<void> {
  await emitEvent("relic-pick-preview");
  await invoke("show_relic_pick_window");
}

export const hidePickPreview = () => emitEvent("relic-pick-preview-close");

export const hideCurrentWindow = () => getCurrentWindow().hide();

/** Makes a display-only overlay let mouse input pass through to the game. */
export const ignoreCurrentWindowCursor = () => getCurrentWindow().setIgnoreCursorEvents(true);

/** Width in CSS px; the window follows the content height. */
export const PICK_WIDTH = 460;

/**
 * Sizes the pick window to its content. With native zoom a CSS pixel is
 * `scale` logical pixels, so the window is the content size times the scale,
 * kept within the monitor.
 */
export async function fitPickWindow(contentHeight: number, scale: number): Promise<void> {
  if (contentHeight <= 0) return;
  const win = getCurrentWindow();
  let width = PICK_WIDTH * scale;
  let height = contentHeight * scale;
  const monitor = await currentMonitor().catch(() => null);
  if (monitor) {
    const f = monitor.scaleFactor || 1;
    width = Math.min(width, monitor.size.width / f);
    height = Math.min(height, monitor.size.height / f);
  }
  await win.setSize(new LogicalSize(Math.round(width), Math.round(height)));
}

/**
 * Sets the window height to its content and keeps the width, for windows the
 * backend places and centres. The backend does not know the text size, so its
 * height alone can cut the content off.
 */
export async function fitWindowHeight(contentHeight: number, scale: number): Promise<void> {
  if (contentHeight <= 0) return;
  const win = getCurrentWindow();
  const [size, factor] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  const height = Math.ceil(contentHeight * scale);
  // Callers also fit after every resize of the window, so a size that already fits must not resize it again.
  if (Math.abs(size.height / factor - height) < 1) return;
  await win.setSize(new LogicalSize(size.width / factor, height));
}

// ── Riven overlay ───────────────────────────────────────────────────────────

/** "Check Riven" in Rivens and "New roll" in the overlay: the backend runs the check. */
export const requestRivenCheck = () => invoke("check_riven");
/** Settings → Overlays → Show: the backend places the window, which then shows the example roll. */
export async function showRivenPreview(): Promise<void> {
  await invoke("show_riven_window");
  await emitEvent("riven-preview");
}
export const hideRivenPreview = () => emitEvent("riven-preview-close");

/** Sets the riven window's width to the text size chosen in the app; the backend places it and sets its height. */
export async function fitRivenWidth(width: number): Promise<void> {
  const win = getCurrentWindow();
  const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  await win.setSize(new LogicalSize(width, size.height / scale));
}
