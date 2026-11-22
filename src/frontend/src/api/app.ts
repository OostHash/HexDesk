import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CacheStatuses } from "../domain/cache";
import type { EventMap, InventoryUpdatePayload } from "./events";
import { invoke } from "./invoke";

/**
 * App-wide state that is not owned by a screen: memory scanner, game and
 * account, blob capture, catalogue refresh and updater.
 * The header (block B) and Settings (block C) read and drive it.
 */
export const appKeys = {
  monitor: ["app", "monitor"] as const,
  player: ["app", "player"] as const,
  game: ["app", "game"] as const,
  blob: ["app", "blob"] as const,
  update: ["app", "update"] as const,
  version: ["app", "version"] as const,
  caches: ["app", "caches"] as const,
};

export type Player = { name: string | null; masteryRank: number | null };
export type GameState = { running: boolean; scannedAt: number | null };
export type BlobStatus = EventMap["blob-status"] | null;

const NO_PLAYER: Player = { name: null, masteryRank: null };
const NO_GAME: GameState = { running: false, scannedAt: null };

/** Pushed state: the cache starts empty and events fill it. */
const pushed = <T>(key: readonly unknown[], empty: T) => ({ queryKey: key, queryFn: () => empty, staleTime: Infinity, gcTime: Infinity }) as const;

// ── Memory scanner ──────────────────────────────────────────────────────────

export function useMonitorStatus() {
  return useQuery({ queryKey: appKeys.monitor, queryFn: () => invoke("get_monitor_status"), staleTime: Infinity });
}

/** Starts or stops the scanner and records the result. */
export async function setScanner(queryClient: QueryClient, enabled: boolean): Promise<void> {
  await invoke(enabled ? "start_monitor" : "stop_monitor");
  queryClient.setQueryData(appKeys.monitor, enabled);
}

export const pokeScan = () => invoke("poke_scan");

// ── Catalogue ───────────────────────────────────────────────────────────────

export type CatalogueResult = { items: number; recipes: number };

/**
 * Loads the item catalogue and refreshes everything built on it. With force
 * the catalogue is downloaded again; the scanner builds its own catalogue at
 * start, so a running scanner is stopped first and started again afterwards.
 */
export async function refreshCatalogue(queryClient: QueryClient, force: boolean): Promise<CatalogueResult> {
  const restart = force && (await invoke("get_monitor_status").catch(() => false));
  if (restart) await setScanner(queryClient, false);
  try {
    const items = await invoke("fetch_item_list", { force });
    const status = await invoke("get_item_list_status");
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["catalog"] }), queryClient.invalidateQueries({ queryKey: ["inventory"] })]);
    void invoke("prewarm_image_cache").catch(() => undefined);
    return { items, recipes: status.recipe_count };
  } finally {
    if (restart) await setScanner(queryClient, true);
  }
}

// ── Game and account ────────────────────────────────────────────────────────

export function usePlayer(): Player {
  const queryClient = useQueryClient();
  return (
    useQuery({
      queryKey: appKeys.player,
      // Merges, so an event that arrived while this was in flight is kept.
      queryFn: async (): Promise<Player> => {
        const name = await invoke("get_player_name").catch(() => null);
        const previous = queryClient.getQueryData<Player>(appKeys.player);
        return { name: previous?.name ?? name, masteryRank: previous?.masteryRank ?? null };
      },
      staleTime: Infinity,
      gcTime: Infinity,
    }).data ?? NO_PLAYER
  );
}

export const useGameState = (): GameState => useQuery(pushed(appKeys.game, NO_GAME)).data ?? NO_GAME;

export function setPlayerName(queryClient: QueryClient, name: string) {
  queryClient.setQueryData<Player>(appKeys.player, (previous) => ({ ...(previous ?? NO_PLAYER), name }));
}

/** The app-wide part of an inventory-update: game running, account, mastery rank. */
export function applyGameState(queryClient: QueryClient, payload: InventoryUpdatePayload) {
  queryClient.setQueryData<GameState>(appKeys.game, (previous) => ({
    running: payload.warframe_running,
    scannedAt: payload.scanned_at ?? previous?.scannedAt ?? null,
  }));
  const name = payload.player_name ?? null;
  const masteryRank = payload.mastery_rank ?? null;
  if (name === null && masteryRank === null) return;
  queryClient.setQueryData<Player>(appKeys.player, (previous) => ({
    name: name ?? previous?.name ?? null,
    masteryRank: masteryRank ?? previous?.masteryRank ?? null,
  }));
}

// ── Blob capture ────────────────────────────────────────────────────────────

export const useBlobStatus = (): BlobStatus => useQuery(pushed<BlobStatus>(appKeys.blob, null)).data ?? null;

export function setBlobStatus(queryClient: QueryClient, status: BlobStatus) {
  queryClient.setQueryData<BlobStatus>(appKeys.blob, status);
}

// ── Data caches ─────────────────────────────────────────────────────────────

const NO_CACHES: CacheStatuses = {};

/** Source and age per backend cache; cache-status events replace it (TauriEventBridge). */
export function useCacheStatuses(): CacheStatuses {
  return useQuery({ queryKey: appKeys.caches, queryFn: () => invoke("get_cache_statuses"), staleTime: Infinity }).data ?? NO_CACHES;
}

export function setCacheStatuses(queryClient: QueryClient, statuses: CacheStatuses) {
  queryClient.setQueryData(appKeys.caches, statuses);
}

export const refreshAllCaches = () => invoke("refresh_all_caches");

// ── Updater and version ─────────────────────────────────────────────────────

/** Version of a newer release, or null. Filled by checkForUpdate at start. */
export const usePendingUpdate = (): string | null => useQuery(pushed<string | null>(appKeys.update, null)).data ?? null;

export async function checkForUpdate(queryClient: QueryClient): Promise<void> {
  const version = await invoke("check_for_update").catch(() => null);
  queryClient.setQueryData(appKeys.update, version);
}

/** Development builds only: pretend a release is (or no longer is) available, to try the update interface. */
export const simulateUpdate = (queryClient: QueryClient, version: string | null) => queryClient.setQueryData(appKeys.update, version);

/**
 * A check started by the user (Settings → General). Unlike the check at
 * start it reports failures; a found update also marks Settings.
 */
export function useCheckForUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("check_for_update"),
    onSuccess: (version) => {
      queryClient.setQueryData(appKeys.update, version);
    },
  });
}

/** Downloads and installs; the backend restarts the app when done. */
export function useInstallUpdate() {
  return useMutation({ mutationFn: () => invoke("install_update") });
}

export function useAppVersion(): string | undefined {
  return useQuery({ queryKey: appKeys.version, queryFn: () => getVersion(), staleTime: Infinity, gcTime: Infinity }).data;
}

/** Deletes everything and restarts the app (backend). */
export const factoryReset = () => invoke("factory_reset");

// ── Main window ─────────────────────────────────────────────────────────────

export type WindowGeometry = { windowX: number; windowY: number; windowWidth: number; windowHeight: number };

/** Outer position and size in physical pixels, as the settings file stores them. */
export async function readWindowGeometry(): Promise<WindowGeometry> {
  const win = getCurrentWindow();
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  return { windowX: position.x, windowY: position.y, windowWidth: size.width, windowHeight: size.height };
}

/** Calls handler (debounced by the caller) whenever the window moves or resizes. */
export async function onWindowMovedOrResized(handler: () => void): Promise<() => void> {
  const win = getCurrentWindow();
  const unlisteners = await Promise.all([win.onMoved(handler), win.onResized(handler)]);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

/**
 * Takes over closing the window: the default close is prevented, beforeQuit
 * runs, then the process exits (force_quit). Only for the main window.
 */
export function onCloseRequested(beforeQuit: () => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await beforeQuit();
    } finally {
      await invoke("force_quit").catch(() => undefined);
    }
  });
}
