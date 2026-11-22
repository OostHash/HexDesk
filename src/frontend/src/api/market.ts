import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { buildWfmLookup, type LivePrice, type PriceMap } from "../domain/market";
import type { CommandArgs } from "./commands";
import type { EventMap } from "./events";
import { invoke } from "./invoke";
import { relicKeys } from "./relics";

export const marketKeys = {
  items: ["market", "wfm-items"] as const,
  prices: ["market", "prices"] as const,
  session: ["market", "session"] as const,
  item: (slug: string) => ["market", "item", slug] as const,
  info: (slug: string) => ["market", "item", slug, "info"] as const,
  stats: (slug: string) => ["market", "item", slug, "stats"] as const,
  orders: (slug: string, rank: number | null) => ["market", "item", slug, "orders", rank] as const,
};

/** The full catalogue as a list (same cache entry as Relics and Inventory). */
export function useCatalogList() {
  return useQuery({ queryKey: relicKeys.catalog, queryFn: () => invoke("get_all_items"), staleTime: Infinity });
}

export function useWfmItems() {
  return useQuery({ queryKey: marketKeys.items, queryFn: () => invoke("fetch_wfm_items"), staleTime: Infinity });
}

const EMPTY_LOOKUP: ReadonlyMap<string, string> = new Map();

/** Normalised item name → warframe.market slug. */
export function useWfmLookup(): ReadonlyMap<string, string> {
  const { data } = useWfmItems();
  return useMemo(() => (data ? buildWfmLookup(data) : EMPTY_LOOKUP), [data]);
}

const EMPTY_PRICES: PriceMap = new Map();

/**
 * Live sell medians by slug: seeded from the backend cache, then updated
 * by wfm-price-update events (TauriEventBridge → applyPriceUpdate).
 */
export function useLivePrices(): { prices: PriceMap; fetched: boolean } {
  const { data } = useQuery({
    queryKey: marketKeys.prices,
    queryFn: async (): Promise<PriceMap> => {
      const cached = await invoke("wfm_get_cached_prices");
      return new Map(Object.entries(cached).map(([slug, price]) => [slug, { sell_median: price }]));
    },
    staleTime: Infinity,
  });
  return { prices: data ?? EMPTY_PRICES, fetched: (data?.size ?? 0) > 0 };
}

let pending = new Map<string, LivePrice>();
let flushScheduled = false;

/** Buffers price events and writes them in one cache update per frame. */
export function applyPriceUpdate(queryClient: QueryClient, payload: EventMap["wfm-price-update"]) {
  pending.set(payload.url_name, { sell_median: payload.sell_median, tradeable: payload.tradeable });
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    const batch = pending;
    pending = new Map();
    flushScheduled = false;
    queryClient.setQueryData<PriceMap>(marketKeys.prices, (previous) => new Map([...(previous ?? []), ...batch]));
  });
}

/** Starts the backend queue once, then queues these slugs (the backend skips duplicates). */
export function useQueuePrices(slugs: readonly string[]) {
  useEffect(() => {
    void invoke("start_wfm_queue").catch(() => undefined);
  }, []);
  const key = slugs.join("|");
  useEffect(() => {
    if (key === "") return;
    void invoke("wfm_queue_prices", { urlNames: key.split("|") }).catch(() => undefined);
  }, [key]);
}

/** Moves one slug to the front of the queue (opening its window). */
export function prioritisePrice(slug: string) {
  void invoke("wfm_queue_price_priority", { urlName: slug }).catch(() => undefined);
}

/** Logged-in warframe.market user, or null. */
export function useWfmUser(): string | null {
  const { data } = useQuery({ queryKey: marketKeys.session, queryFn: () => invoke("wfm_get_session"), staleTime: 30_000 });
  return data?.[0] ?? null;
}

export function useItemInfo(slug: string) {
  return useQuery({ queryKey: marketKeys.info(slug), queryFn: () => invoke("wfm_get_item_info", { urlName: slug }), staleTime: Infinity });
}

export function useItemStats(slug: string) {
  return useQuery({
    queryKey: marketKeys.stats(slug),
    queryFn: async () => {
      const stats = await invoke("wfm_get_item_statistics", { urlName: slug });
      return Array.isArray(stats) ? stats : [];
    },
    staleTime: 5 * 60_000,
  });
}

/** Orders of one item; `rank` only for mods and arcanes. */
export function useItemOrders(slug: string, rank: number | null, enabled = true) {
  return useQuery({
    queryKey: marketKeys.orders(slug, rank),
    queryFn: () => invoke("wfm_get_item_orders", { urlName: slug, modRank: rank }),
    staleTime: 30_000,
    enabled,
  });
}

type CreateOrderArgs = CommandArgs<"wfm_create_order">;

/** A 401 refreshes the token once and retries. */
async function createOrder(args: CreateOrderArgs) {
  try {
    return await invoke("wfm_create_order", args);
  } catch (error) {
    if (!String(error).includes("401")) throw error;
    const refreshed = await invoke("wfm_refresh_token")
      .then(() => true)
      .catch(() => false);
    if (!refreshed) throw new Error("Session expired. Please log in again in the Trading tab.", { cause: error });
    return invoke("wfm_create_order", args);
  }
}

/** Posts an order on warframe.market. */
export function useCreateOrder(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (order: Omit<CreateOrderArgs, "itemId"> & { itemId: string | null }) => {
      const itemId = order.itemId ?? (await invoke("wfm_get_item_info", { urlName: slug }).catch(() => null))?.id;
      if (!itemId) throw new Error("This item isn't individually listed on warframe.market. Try listing the full set instead.");
      return createOrder({ ...order, itemId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketKeys.item(slug) });
    },
  });
}
