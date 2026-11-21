import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { clockFormatFrom, displayItemName, type ClockFormat, type TopItem, type TopProgress, type TrackedItem } from "../domain/statistics";
import { useEvent } from "./events";
import { invoke } from "./invoke";
import { useSettings } from "./settings";

/** trades-updated invalidates ["trades"] (TauriEventBridge). */
export const statsKeys = {
  trades: ["trades"] as const,
  top: ["stats", "top-items"] as const,
  tracked: ["stats", "tracked"] as const,
  snapshots: (id: string) => ["stats", "snapshots", id] as const,
  locale: ["stats", "locale"] as const,
};

/** Trades with clean item names (rank stars → "(Rn)"). */
export function useTrades() {
  return useQuery({
    queryKey: statsKeys.trades,
    queryFn: async () => (await invoke("get_trades")).map((t) => ({ ...t, item_name: displayItemName(t.item_name) })),
  });
}

/** The 7-day top list plus scan progress (events from the backend scan). */
export function useTopItems(): { items: TopItem[] | undefined; isPending: boolean; error: Error | null; progress: TopProgress | null } {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: statsKeys.top, queryFn: () => invoke("get_wfm_top_items"), staleTime: 10 * 60_000 });
  const [progress, setProgress] = useState<TopProgress | null>(null);
  useEvent("wfm-top-progress", setProgress);
  useEvent("wfm-top-updated", (items) => {
    queryClient.setQueryData(statsKeys.top, items);
    setProgress(null);
  });
  return { items: query.data, isPending: query.isPending, error: query.error, progress };
}

/** Clock setting and the OS locale, for dates and times. */
export function useClock(): { clock: ClockFormat; locale: string } {
  const { data: settings } = useSettings();
  const { data: locale } = useQuery({ queryKey: statsKeys.locale, queryFn: () => invoke("get_system_locale"), staleTime: Infinity });
  return { clock: clockFormatFrom(settings?.clockFormat), locale: locale || "en-US" };
}

export function useTrackedItems() {
  return useQuery({ queryKey: statsKeys.tracked, queryFn: () => invoke("get_tracked_items") });
}

/** All snapshots per tracked item. */
export function useSnapshots(items: readonly TrackedItem[]) {
  const results = useQueries({
    queries: items.map((i) => ({
      queryKey: statsKeys.snapshots(i.unique_name),
      queryFn: () => invoke("get_item_snapshots", { uniqueName: i.unique_name, days: null }).catch(() => []),
    })),
  });
  return useMemo(() => new Map(items.map((i, n) => [i.unique_name, results[n]?.data ?? []])), [items, results]);
}

export function useTrackActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: statsKeys.tracked });
  const add = useMutation({
    mutationFn: (item: { uniqueName: string; displayName: string }) => invoke("add_tracked_item", item),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (uniqueName: string) => invoke("remove_tracked_item", { uniqueName }),
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: statsKeys.snapshots(id) });
    },
    onSettled: refresh,
  });
  return { add, remove };
}

const ORDER_KEY = "ff-item-report-order";

/** Card order. */
export function useCardOrder(): [string[], (order: string[]) => void] {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  return [
    order,
    (next) => {
      setOrder(next);
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    },
  ];
}
