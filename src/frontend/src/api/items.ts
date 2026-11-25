import { useQuery } from "@tanstack/react-query";
import type { CardMeta } from "../domain/items";
import { invoke } from "./invoke";

/** Under ["catalog"], so catalogue-updated (TauriEventBridge) refreshes them. */
export const itemKeys = {
  cardMeta: ["catalog", "card-meta"] as const,
  details: (uniqueName: string) => ["catalog", "item-details", uniqueName] as const,
};

/** Card facts of every mod and arcane, by uniqueName; empty while loading. */
export function useCardMeta(): Readonly<Record<string, CardMeta>> {
  return useQuery({ queryKey: itemKeys.cardMeta, queryFn: () => invoke("get_card_meta"), staleTime: Infinity }).data ?? EMPTY;
}

/** Details of one mod or arcane; data is null for items without details. */
export function useItemDetails(uniqueName: string | null) {
  return useQuery({
    queryKey: itemKeys.details(uniqueName ?? ""),
    queryFn: () => invoke("get_item_details", { uniqueName: uniqueName ?? "" }),
    enabled: uniqueName !== null,
    staleTime: Infinity,
  });
}

const EMPTY: Readonly<Record<string, CardMeta>> = {};
