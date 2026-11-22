import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Ownership } from "../domain/completionist";
import type { ChangeEntry, ModCounts } from "../domain/inventory";
import type { InventoryUpdatePayload } from "./events";
import { invoke } from "./invoke";

export const quantitiesKeys = { all: ["inventory", "quantities"] as const };
export const consumedKeys = { all: ["inventory", "consumed"] as const };
/**
 * Mastery is pushed by the backend (inventory-update), never pulled: there is
 * no command for it. It lives outside the ["inventory"] prefix so an
 * invalidation of inventory queries can never wipe it.
 */
export const masteryKeys = { all: ["mastery"] as const };
/** Pushed-only data (no command): kept outside ["inventory"] like mastery. */
export const liveKeys = {
  mods: ["live", "mods"] as const,
  crafting: ["live", "crafting"] as const,
  shards: ["live", "shards"] as const,
  forma: ["live", "forma"] as const,
};
export const changeKeys = { all: ["inventory", "changes"] as const };
export const bulkPriceKeys = { all: ["prices", "bulk"] as const };

/** Up to 200 recent quantity changes (newest first). */
export function useChangeLog() {
  return useQuery({ queryKey: changeKeys.all, queryFn: () => invoke("get_change_log", { limit: 200 }) });
}

const pushedOnly = <T>(key: readonly unknown[], empty: T) =>
  ({ queryKey: key, queryFn: () => empty, staleTime: Infinity, gcTime: Infinity }) as const;

export function useModCounts() {
  return useQuery(pushedOnly<ModCounts>(liveKeys.mods, {})).data ?? EMPTY_MODS;
}

export type ShardMap = Readonly<Record<string, ReadonlyArray<{ upgrade_type: string; color: string }>>>;
export function useShards() {
  return useQuery(pushedOnly<ShardMap>(liveKeys.shards, {})).data ?? EMPTY_SHARDS;
}

export function useFormaCounts() {
  return useQuery(pushedOnly<Readonly<Record<string, number>>>(liveKeys.forma, {})).data ?? EMPTY_FORMA;
}

export function useCrafting() {
  return useQuery(pushedOnly<InventoryUpdateCrafting>(liveKeys.crafting, [])).data ?? EMPTY_CRAFTING;
}

/** Bulk platinum prices; `null` while loading or when unavailable. */
export function useBulkPrices(): { prices: ReadonlyMap<string, number> | null; status: "loading" | "ready" | "unavailable" } {
  const query = useQuery({
    queryKey: bulkPriceKeys.all,
    queryFn: async () => new Map(Object.entries(await invoke("get_bulk_prices"))),
    staleTime: 10 * 60_000,
  });
  if (query.isPending) return { prices: null, status: "loading" };
  if (query.isError || query.data.size === 0) return { prices: null, status: "unavailable" };
  return { prices: query.data, status: "ready" };
}

export function useItemListStatus() {
  return useQuery({ queryKey: ["catalog", "status"] as const, queryFn: () => invoke("get_item_list_status") }).data;
}

type InventoryUpdateCrafting = InventoryUpdatePayload["crafting"];
const EMPTY_MODS: ModCounts = {};
const EMPTY_CRAFTING: InventoryUpdateCrafting = [];
const EMPTY_SHARDS: ShardMap = {};
const EMPTY_FORMA: Readonly<Record<string, number>> = {};

/** A full pass replaces; any other update merges only what is not empty. */
function replaceOrMerge<T>(queryClient: QueryClient, key: readonly unknown[], incoming: Record<string, T> | undefined, full: boolean) {
  if (!incoming) return;
  if (full) queryClient.setQueryData(key, incoming);
  else if (Object.keys(incoming).length > 0) queryClient.setQueryData<Record<string, T>>(key, (previous) => ({ ...previous, ...incoming }));
}

/** Owned quantity per uniqueName. */
export function useQuantities() {
  return useQuery({
    queryKey: quantitiesKeys.all,
    queryFn: () => invoke("get_current_quantities"),
  });
}

function useConsumedSuits() {
  return useQuery({
    queryKey: consumedKeys.all,
    queryFn: async () => (await invoke("get_saved_inventory")).consumedSuits,
  });
}

function useMastery() {
  return useQuery({
    queryKey: masteryKeys.all,
    queryFn: (): Record<string, number> => ({}),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

const EMPTY: Readonly<Record<string, number>> = {};

/** Quantities, mastery and Helminth state together, for completion views. */
export function useOwnership(): { ownership: Ownership; isPending: boolean; isError: boolean; refetch: () => void } {
  const quantities = useQuantities();
  const consumed = useConsumedSuits();
  const mastery = useMastery();
  const ownership = useMemo(
    () => ({
      quantities: quantities.data ?? EMPTY,
      mastery: mastery.data ?? EMPTY,
      subsumed: new Set(consumed.data ?? []),
    }),
    [quantities.data, mastery.data, consumed.data],
  );
  return {
    ownership,
    isPending: quantities.isPending,
    isError: quantities.isError,
    refetch: () => {
      void quantities.refetch();
      void consumed.refetch();
    },
  };
}

/**
 * Writes an inventory-update event into the cache:
 * quantities are replaced, mastery is merged, consumed suits only replace
 * the cache when the scanner reported any.
 */
export function applyInventoryUpdate(queryClient: QueryClient, payload: InventoryUpdatePayload) {
  queryClient.setQueryData(quantitiesKeys.all, payload.quantities);
  if (Object.keys(payload.mastery_data).length > 0) {
    queryClient.setQueryData<Record<string, number>>(masteryKeys.all, (previous) => ({ ...previous, ...payload.mastery_data }));
  }
  if (payload.consumed_suits.length > 0) queryClient.setQueryData(consumedKeys.all, payload.consumed_suits);
  if (Object.keys(payload.mods).length > 0) queryClient.setQueryData(liveKeys.mods, payload.mods);
  queryClient.setQueryData(liveKeys.crafting, payload.crafting);
  replaceOrMerge(queryClient, liveKeys.shards, payload.socketed_shards, payload.is_full_pass === true);
  replaceOrMerge(queryClient, liveKeys.forma, payload.forma_counts, payload.is_full_pass === true);
  if (payload.changes.length > 0) {
    queryClient.setQueryData<ChangeEntry[]>(changeKeys.all, (previous) => [...payload.changes, ...(previous ?? [])].slice(0, 200));
  }
}

/** Downloads the bulk prices again and refreshes every price query. */
export async function refreshBulkPrices(queryClient: QueryClient): Promise<void> {
  await invoke("refresh_bulk_prices");
  await queryClient.invalidateQueries({ queryKey: ["prices"] });
}

/**
 * Clears the scanned inventory in the backend, then empties what the app
 * holds of it: pushed data (mastery, mods, crafting, shards, Forma) is reset
 * here because no command would refill it; the rest is fetched again.
 */
export async function clearInventoryCache(queryClient: QueryClient): Promise<void> {
  await invoke("clear_cache");
  queryClient.setQueryData(masteryKeys.all, {});
  queryClient.setQueryData(liveKeys.mods, {});
  queryClient.setQueryData(liveKeys.crafting, []);
  queryClient.setQueryData(liveKeys.shards, {});
  queryClient.setQueryData(liveKeys.forma, {});
  await queryClient.invalidateQueries({ queryKey: ["inventory"] });
}
