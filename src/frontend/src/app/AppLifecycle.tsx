import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  checkForUpdate,
  onCloseRequested,
  onWindowMovedOrResized,
  readWindowGeometry,
  refreshCatalogue,
  setBlobStatus,
  setScanner,
} from "../api/app";
import { isTauri } from "../api/env";
import { onEvent } from "../api/events";
import { invoke } from "../api/invoke";
import { settingsKeys, useSettings, type SettingsFile } from "../api/settings";
import { goInvisible, useSession } from "../api/trading";
import { autoInvisibleMinutes } from "../domain/settings";

/** How long "done" from the blob capture stays visible. */
export const BLOB_DONE_MS = 4000;
/** Closing waits at most this long for warframe.market. */
export const CLOSE_INVISIBLE_TIMEOUT_MS = 8000;
const GEOMETRY_DEBOUNCE_MS = 400;

const withTimeout = (work: Promise<unknown>, ms: number) => Promise.race([work, new Promise<void>((resolve) => window.setTimeout(resolve, ms))]);

/**
 * The app core of the main window: memory scanner,
 * catalogue at start, updater, blob status, warframe.market auto-invisible,
 * closing and window geometry. Renders nothing; the header and Settings show
 * and drive the state it keeps in the query cache.
 */
export function AppLifecycle() {
  const queryClient = useQueryClient();
  const { data: settings, isSuccess: settingsLoaded } = useSettings();
  const { data: session } = useSession();
  const loggedIn = session != null;

  // ── Memory scanner follows the setting ────────────────────────────────────
  const scannerEnabled = settings?.memoryScannerEnabled === true;
  const appliedScanner = useRef<boolean | null>(null);
  useEffect(() => {
    if (!settingsLoaded || appliedScanner.current === scannerEnabled) return;
    appliedScanner.current = scannerEnabled;
    setScanner(queryClient, scannerEnabled).catch((error: unknown) => {
      appliedScanner.current = null;
      console.error("memory scanner: switching failed", error);
    });
  }, [queryClient, scannerEnabled, settingsLoaded]);

  // ── Once at start ─────────────────────────────────────────────────────────
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A failure keeps the cached catalogue; Settings offers a manual refresh.
    refreshCatalogue(queryClient, false).catch(() => undefined);
    // Fills the backend top-items cache so Statistics opens at once.
    invoke("get_wfm_top_items").catch(() => undefined);
    // A dev build must never download a release over itself.
    if (!import.meta.env.DEV) void checkForUpdate(queryClient);
  }, [queryClient]);

  // ── Blob capture status ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let clear: number | undefined;
    void onEvent("blob-status", (status) => {
      window.clearTimeout(clear);
      if (status.stage === "scanning") setBlobStatus(queryClient, status);
      else if (status.stage === "done") {
        setBlobStatus(queryClient, status);
        clear = window.setTimeout(() => {
          setBlobStatus(queryClient, null);
        }, BLOB_DONE_MS);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      window.clearTimeout(clear);
      unlisten?.();
    };
  }, [queryClient]);

  // ── warframe.market: invisible after N minutes ────────────────────────────
  const autoInvisible = settings?.wfmAutoInvisible === true;
  const autoInvisibleMins = autoInvisibleMinutes(settings?.wfmAutoInvisibleMins);
  useEffect(() => {
    if (!autoInvisible || !loggedIn) return;
    const id = window.setTimeout(() => {
      void goInvisible(queryClient);
    }, autoInvisibleMins * 60_000);
    return () => {
      window.clearTimeout(id);
    };
  }, [autoInvisible, autoInvisibleMins, loggedIn, queryClient]);

  // ── Closing: optionally invisible first, then quit ────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onCloseRequested(async () => {
      // Read at close time, so the latest setting counts.
      const current = queryClient.getQueryData<SettingsFile>(settingsKeys.all);
      if (current?.wfmInvisibleOnClose === true) await withTimeout(goInvisible(queryClient), CLOSE_INVISIBLE_TIMEOUT_MS);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient]);

  // ── Window position and size ──────────────────────────────────────────────
  // Saved straight to the file: the window moving is not a settings change
  // the UI needs to see.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let pending: number | undefined;
    void onWindowMovedOrResized(() => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        readWindowGeometry()
          .then((geometry) => invoke("save_settings", { json: JSON.stringify(geometry) }))
          .catch(() => undefined);
      }, GEOMETRY_DEBOUNCE_MS);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      window.clearTimeout(pending);
      unlisten?.();
    };
  }, []);

  return null;
}
