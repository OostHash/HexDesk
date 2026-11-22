import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  activeAuctions,
  completeWhisper,
  isSettable,
  matchSale,
  MAX_CHANGES,
  pruneGhosts,
  revertAction,
  saleAction,
  soldText,
  type ListingChange,
  type RevertInfo,
  type SaleAction,
  type SettableStatus,
  tradeLogRows,
  type TradeCompleted,
  type Whisper,
  type WfmStatus,
} from "../domain/trading";
import type { CommandArgs, CommandName, CommandResult } from "./commands";
import { emitEvent, type EventMap } from "./events";
import { invoke } from "./invoke";
import { marketKeys, useWfmItems } from "./market";
import { settingsKeys, type SettingsFile } from "./settings";

export const tradingKeys = {
  orders: ["market", "my-orders"] as const,
  auctions: ["market", "my-auctions"] as const,
  whispers: ["market", "whispers"] as const,
  changes: ["market", "listing-changes"] as const,
  unread: ["market", "unread"] as const,
};

/**
 * Invokes a warframe.market command; a 401 refreshes the token once and
 * retries (the current Trading tab only reported "session expired").
 */
export async function invokeWfm<C extends CommandName>(
  command: C,
  ...args: CommandArgs<C> extends undefined ? [] : [CommandArgs<C>]
): Promise<CommandResult<C>> {
  const call = () => (invoke as (c: C, ...a: typeof args) => Promise<CommandResult<C>>)(command, ...args);
  try {
    return await call();
  } catch (error) {
    if (!String(error).includes("401")) throw error;
    const refreshed = await invoke("wfm_refresh_token")
      .then(() => true)
      .catch(() => false);
    if (!refreshed) throw new Error("Your warframe.market session expired. Log in again.", { cause: error });
    return call();
  }
}

// ── Session ─────────────────────────────────────────────────────────────────

export type Session = { user: string; status: WfmStatus } | null;

const toSession = (s: [string, string] | null): Session => (s ? { user: s[0], status: isSettable(s[1]) ? s[1] : "offline" } : null);

export function useSession() {
  return useQuery({ queryKey: marketKeys.session, queryFn: () => invoke("wfm_get_session"), staleTime: 30_000, select: toSession });
}

/** Saves the current token again (it carries a fresh CSRF token), under `email`. */
async function resaveToken(email: string) {
  const token = await invoke("wfm_get_jwt").catch(() => null);
  if (token) await invoke("wfm_save_credentials", { email, token }).catch(() => undefined);
}

/**
 * Restores a session at app start: an existing backend session, else the
 * saved token. Optionally goes invisible (setting wfmInvisibleOnStart).
 */
export async function restoreSession(queryClient: QueryClient, invisibleOnStart: boolean): Promise<void> {
  const existing = await invoke("wfm_get_session").catch(() => null);
  if (existing) {
    queryClient.setQueryData(marketKeys.session, existing);
    return;
  }
  const creds = await invoke("wfm_load_credentials").catch(() => null);
  if (!creds) return;
  try {
    const session = await invoke("wfm_set_jwt", { jwt: creds[1] });
    await resaveToken(creds[0]);
    queryClient.setQueryData(marketKeys.session, session);
    if (invisibleOnStart) {
      await invoke("wfm_set_status", { status: "invisible" }).catch(() => undefined);
      queryClient.setQueryData<[string, string]>(marketKeys.session, [session[0], "invisible"]);
    }
  } catch {
    // Token expired: Trading shows the login form.
  }
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password, remember }: { email: string; password: string; remember: boolean }) => {
      const user = await invoke("wfm_login", { email, password });
      if (remember) await resaveToken(email);
      // A fresh session starts invisible, so the user decides when to appear.
      await invoke("wfm_set_status", { status: "invisible" }).catch(() => undefined);
      return user;
    },
    onSuccess: (user) => {
      queryClient.setQueryData<[string, string]>(marketKeys.session, [user, "invisible"]);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return () => {
    void invoke("wfm_logout").catch(() => undefined);
    queryClient.setQueryData(marketKeys.session, null);
    queryClient.removeQueries({ queryKey: tradingKeys.orders });
    queryClient.removeQueries({ queryKey: tradingKeys.auctions });
  };
}

export function useSetStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: SettableStatus) => invoke("wfm_set_status", { status }),
    onSuccess: (_r, status) => {
      queryClient.setQueryData<[string, string] | null>(marketKeys.session, (s) => (s ? [s[0], status] : s));
    },
  });
}

/**
 * Goes invisible on warframe.market when logged in (auto-invisible timer,
 * closing the app). Never throws; true when the status was set.
 */
export async function goInvisible(queryClient: QueryClient): Promise<boolean> {
  const session = queryClient.getQueryData<[string, string] | null>(marketKeys.session);
  if (!session) return false;
  const ok = await invoke("wfm_set_status", { status: "invisible" })
    .then(() => true)
    .catch(() => false);
  if (ok) queryClient.setQueryData<[string, string]>(marketKeys.session, [session[0], "invisible"]);
  return ok;
}

/**
 * The 2-minute poll: warframe.market sometimes drops you to offline; then
 * the status you chose is set again.
 */
export async function syncStatus(queryClient: QueryClient): Promise<void> {
  const session = queryClient.getQueryData<[string, string] | null>(marketKeys.session);
  if (!session) return;
  const fetched = await invoke("wfm_fetch_status").catch(() => null);
  if (fetched === null) return;
  const wanted = session[1];
  if (fetched === "offline" && isSettable(wanted)) {
    const ok = await invoke("wfm_set_status", { status: wanted })
      .then(() => true)
      .catch(() => false);
    if (!ok) queryClient.setQueryData<[string, string]>(marketKeys.session, [session[0], "offline"]);
    return;
  }
  queryClient.setQueryData<[string, string]>(marketKeys.session, [session[0], fetched]);
}

// ── Orders and auctions ─────────────────────────────────────────────────────

/** WFM item id → name, for orders that only carry an itemId. */
export function useItemNames(): ReadonlyMap<string, string> {
  const { data } = useWfmItems();
  return useMemo(() => new Map((data ?? []).map((i) => [i.id, i.item_name])), [data]);
}

export function useMyOrders(enabled: boolean) {
  return useQuery({ queryKey: tradingKeys.orders, queryFn: () => invokeWfm("wfm_get_orders"), enabled, staleTime: 30_000 });
}

export function useMyAuctions(enabled: boolean) {
  return useQuery({
    queryKey: tradingKeys.auctions,
    queryFn: async () => activeAuctions((await invokeWfm("wfm_get_my_riven_auctions")).payload?.auctions ?? []),
    enabled,
    staleTime: 30_000,
  });
}

/** Runs a batch of warframe.market writes, then refreshes my orders and auctions. */
export function useTradingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tradingKeys.orders });
      void queryClient.invalidateQueries({ queryKey: tradingKeys.auctions });
    },
  });
}

export const updateOrder = (args: CommandArgs<"wfm_update_order">) => invokeWfm("wfm_update_order", args);
export const deleteOrder = (orderId: string) => invokeWfm("wfm_delete_order", { orderId });
export const setAuctionVisible = (auctionId: string, visible: boolean) => invokeWfm("wfm_set_auction_visible", { auctionId, visible });
export const deleteAuction = (auctionId: string) => invokeWfm("wfm_delete_auction", { auctionId });

/** Same type: update in place. Other type: the backend deletes and recreates it. */
export function saveAuction(id: string, wasDirect: boolean, edit: { direct: boolean; start: number; buyout: number | null; visible: boolean }) {
  if (edit.direct !== wasDirect) {
    return invokeWfm("wfm_switch_riven_type", {
      auctionId: id,
      newIsDirectSell: edit.direct,
      startingPrice: edit.start,
      buyoutPrice: edit.direct ? edit.start : edit.buyout,
      visible: edit.visible,
    });
  }
  return invokeWfm("wfm_update_auction", { auctionId: id, startingPrice: edit.start, buyoutPrice: edit.buyout, visible: edit.visible });
}

// ── Whispers and finished trades ────────────────────────────────────────────

const pushed = <T>(key: readonly unknown[], empty: T) => ({ queryKey: key, queryFn: () => empty, staleTime: Infinity, gcTime: Infinity }) as const;
const NO_WHISPERS: Whisper[] = [];
const NO_CHANGES: ListingChange[] = [];

export const useWhispers = () => useQuery(pushed<Whisper[]>(tradingKeys.whispers, [])).data ?? NO_WHISPERS;
export const useListingChanges = () => useQuery(pushed<ListingChange[]>(tradingKeys.changes, [])).data ?? NO_CHANGES;
export const useUnread = () => useQuery(pushed(tradingKeys.unread, 0)).data ?? 0;

export function setWhispers(queryClient: QueryClient, update: (list: Whisper[]) => Whisper[]) {
  queryClient.setQueryData<Whisper[]>(tradingKeys.whispers, (list) => update(list ?? []));
}
export const markRead = (queryClient: QueryClient) => queryClient.setQueryData(tradingKeys.unread, 0);

let whisperSeq = 0;

export function addWhisper(queryClient: QueryClient, payload: EventMap["wfm-whisper"]) {
  whisperSeq += 1;
  setWhispers(queryClient, (list) => [...list, { ...payload, id: `w${String(whisperSeq)}` }]);
  queryClient.setQueryData<number>(tradingKeys.unread, (n) => (n ?? 0) + 1);
}

async function runSale(action: SaleAction) {
  if (action.kind === "close") return invokeWfm("wfm_close_order", { orderId: action.orderId, quantity: action.quantity });
  if (action.kind === "update")
    return invokeWfm("wfm_update_order", { orderId: action.orderId, platinum: action.platinum, quantity: action.quantity, visible: action.visible });
  return invokeWfm("wfm_delete_order", { orderId: action.orderId });
}

/**
 * A trade finished in game: mark the whisper, copy the thank-you, and for a
 * sale update my warframe.market listing (writes to warframe.market).
 */
export async function handleTradeCompleted(
  queryClient: QueryClient,
  trade: TradeCompleted,
  itemNames: ReadonlyMap<string, string>,
  now = Date.now(),
) {
  let whisper: Whisper | null = null;
  setWhispers(queryClient, (list) => {
    const done = completeWhisper(list, trade.withPlayer, now);
    whisper = done?.whisper ?? null;
    return done?.list ?? list;
  });
  const matched = whisper as Whisper | null;
  if (matched?.item) void navigator.clipboard.writeText(soldText(matched.from, matched.item)).catch(() => undefined);
  if (trade.tradeType !== "sale") return;

  const settings = queryClient.getQueryData<SettingsFile>(settingsKeys.all);
  const recordSales = settings?.wfmRecordSales === true;
  const orders = await invokeWfm("wfm_get_orders");
  const sells = orders.filter((o) => o.type === "sell");
  for (const match of matchSale(sells, itemNames, matched?.item, trade.offeredItems)) {
    const { action, revert, newQty } = saleAction(match, recordSales);
    await runSale(action);
    const change: ListingChange = {
      id: `${String(now)}-${match.order.id}`,
      timestamp: now,
      action: newQty > 0 ? "decreased" : "completed",
      itemName: match.itemName,
      withPlayer: trade.withPlayer,
      platinum: match.order.platinum,
      oldQty: match.order.quantity,
      newQty,
      ...(revert ? { revertInfo: revert } : {}),
    };
    queryClient.setQueryData<ListingChange[]>(tradingKeys.changes, (list) => [change, ...(list ?? [])].slice(0, MAX_CHANGES));
    if (revert && matched) {
      const id = matched.id;
      setWhispers(queryClient, (list) => list.map((w) => (w.id === id && !w.revertInfo ? { ...w, revertInfo: revert } : w)));
    }
  }
  void queryClient.invalidateQueries({ queryKey: tradingKeys.orders });
}

export const pruneWhispers = (queryClient: QueryClient, now = Date.now()) => {
  setWhispers(queryClient, (list) => pruneGhosts(list, now));
};

/** Undo an automatic listing update. */
export async function revertListing(info: RevertInfo) {
  const action = revertAction(info);
  if (action.kind === "update") {
    await invokeWfm("wfm_update_order", { orderId: action.orderId, platinum: action.platinum, quantity: action.quantity, visible: action.visible });
  } else {
    await invokeWfm("wfm_create_order", {
      itemId: action.itemId,
      orderType: "sell",
      platinum: action.platinum,
      quantity: action.quantity,
      visible: action.visible,
      modRank: action.modRank,
    });
  }
}

/**
 * Writes a finished in-game trade to the trade log (Statistics), one row at a
 * time so their order is kept, then tells every window. A failed row is
 * logged and the rest still written.
 */
export async function logInGameTrade(trade: TradeCompleted): Promise<void> {
  for (const params of tradeLogRows(trade)) {
    await invoke("add_trade", { params }).catch((error: unknown) => {
      console.error("trade log: add_trade failed", error);
    });
  }
  await emitEvent("trades-updated").catch(() => undefined);
}

/** "Sold" on a whisper logs the trade for Statistics. */
export async function logSale(from: string, item: string, platinum: number) {
  await invoke("add_trade", {
    params: { withPlayer: from, direction: "sold", itemName: item, itemUrl: "", quantity: 1, platinum, source: "wfm", notes: "" },
  });
  await emitEvent("trades-updated").catch(() => undefined);
}
