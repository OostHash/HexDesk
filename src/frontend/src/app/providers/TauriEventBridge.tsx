import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { applyGameState, setCacheStatuses, setPlayerName } from "../../api/app";
import { isTauri } from "../../api/env";
import { onEvent, type EventName } from "../../api/events";
import { applyInventoryUpdate, quantitiesKeys } from "../../api/inventory";
import { applyPriceUpdate } from "../../api/market";

/**
 * Which cached queries a backend event makes stale. Queries that do not
 * exist are not affected.
 */
export const EVENT_INVALIDATIONS: Partial<Record<EventName, readonly QueryKey[]>> = {
  "catalogue-updated": [["catalog"], ["inventory"]],
  "bulk-prices-updated": [["prices"]],
  "trades-updated": [["trades"]],
  "settings-updated": [["settings"]],
  "riven-roll-saved": [["rivens", "saved"]],
  "test-report-flows": [["testing", "flows"]],
};

/** Subscribes once per window and invalidates the mapped queries. Renders nothing. */
export function TauriEventBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    // Events that carry data are written into the cache directly.
    void onEvent("inventory-update", (payload) => {
      applyInventoryUpdate(queryClient, payload);
      applyGameState(queryClient, payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void onEvent("player-name", (name) => {
      setPlayerName(queryClient, name);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    // A relic reward picked up: one item's quantity, before the next scan.
    void onEvent("inventory-reward", ({ path, qty }) => {
      queryClient.setQueryData<Record<string, number>>(quantitiesKeys.all, (previous) => ({ ...previous, [path]: qty }));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void onEvent("cache-status", (statuses) => {
      setCacheStatuses(queryClient, statuses);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void onEvent("wfm-price-update", (payload) => {
      applyPriceUpdate(queryClient, payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    for (const [event, keys] of Object.entries(EVENT_INVALIDATIONS) as Array<[EventName, readonly QueryKey[]]>) {
      void onEvent(event, () => {
        for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      }).then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      });
    }
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [queryClient]);

  return null;
}
