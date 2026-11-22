import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { isTauri } from "../api/env";
import { onEvent } from "../api/events";
import { useSettings } from "../api/settings";
import { addWhisper, handleTradeCompleted, logInGameTrade, pruneWhispers, restoreSession, syncStatus, useItemNames } from "../api/trading";
import { GHOST_MS } from "../domain/trading";
import { toast } from "../primitives/overlay";

const STATUS_POLL_MS = 2 * 60_000;

/**
 * warframe.market in the background (main window only). Screens unmount in
 * this app, so whispers, finished trades, the session restore at start and
 * the status poll live here, not in the Trading tab.
 */
export function TradeWatcher() {
  const queryClient = useQueryClient();
  const { data: settings, isSuccess: settingsLoaded } = useSettings();
  const itemNames = useItemNames();
  const names = useRef(itemNames);
  useEffect(() => {
    names.current = itemNames;
  }, [itemNames]);
  const restored = useRef(false);

  useEffect(() => {
    if (!settingsLoaded || restored.current) return;
    restored.current = true;
    void restoreSession(queryClient, settings.wfmInvisibleOnStart === true);
  }, [queryClient, settings, settingsLoaded]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void syncStatus(queryClient);
    }, STATUS_POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (p: Promise<() => void>) => {
      void p.then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      });
    };
    keep(
      onEvent("wfm-whisper", (payload) => {
        addWhisper(queryClient, payload);
      }),
    );
    keep(
      onEvent("trade-completed", (trade) => {
        // Every finished trade goes to the trade log, logged in or not.
        void logInGameTrade(trade);
        handleTradeCompleted(queryClient, trade, names.current)
          .catch((error: unknown) => {
            toast({ title: "Could not update your warframe.market listing", description: String(error), tone: "danger" });
          })
          .finally(() => {
            window.setTimeout(() => {
              pruneWhispers(queryClient);
            }, GHOST_MS + 1000);
          });
      }),
    );
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [queryClient]);

  return null;
}
