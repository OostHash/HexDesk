import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RollStat } from "../domain/rivens";
import type { CommandArgs } from "./commands";
import { invoke } from "./invoke";
import { relicKeys } from "./relics";
import { invokeWfm, tradingKeys } from "./trading";

export const rivenKeys = {
  weapons: ["rivens", "weapons"] as const,
  analysis: (weapon: string, positives: readonly string[], negatives: readonly string[]) =>
    ["rivens", "analysis", weapon, positives, negatives] as const,
  saved: ["rivens", "saved"] as const,
  owned: ["rivens", "owned"] as const,
  dispositions: ["rivens", "dispositions"] as const,
};

export function useRivenWeapons() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: rivenKeys.weapons, queryFn: () => invoke("get_riven_weapons"), staleTime: Infinity });
  const reload = useMutation({
    mutationFn: async () => {
      await invoke("reload_riven_database");
      return invoke("get_riven_weapons");
    },
    onSuccess: (weapons) => {
      queryClient.setQueryData(rivenKeys.weapons, weapons);
    },
  });
  return { ...query, reload };
}

/** Analysis of the chosen stats; null without a weapon or stats. */
export function useRivenAnalysis(weapon: string, positives: readonly string[], negatives: readonly string[]) {
  return useQuery({
    queryKey: rivenKeys.analysis(weapon, positives, negatives),
    queryFn: () => invoke("analyze_riven", { weapon, positives: [...positives], negatives: [...negatives] }),
    enabled: weapon !== "" && positives.length + negatives.length > 0,
    staleTime: Infinity,
    placeholderData: (previous) => previous,
  });
}

export function useSavedRolls() {
  return useQuery({ queryKey: rivenKeys.saved, queryFn: () => invoke("get_saved_riven_rolls"), staleTime: Infinity });
}

/** Save, update (delete + save), rename and delete saved rolls. */
export function useRollActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: rivenKeys.saved });
  const save = useMutation({
    mutationFn: async (roll: {
      replaceId: string | null;
      weapon: string;
      label: string;
      stats: readonly RollStat[];
      verdict: string;
      score: number;
    }) => {
      if (roll.replaceId) await invoke("delete_saved_riven_roll", { id: roll.replaceId });
      return invoke("save_riven_roll", {
        weapon: roll.weapon,
        label: roll.label,
        statsJson: JSON.stringify(roll.stats),
        verdict: roll.verdict,
        score: roll.score,
      });
    },
    onSettled: refresh,
  });
  const rename = useMutation({ mutationFn: (r: { id: string; label: string }) => invoke("rename_saved_riven_roll", r), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => invoke("delete_saved_riven_roll", { id }), onSettled: refresh });
  return { save, rename, remove };
}

export function useOwnedRivens() {
  return useQuery({ queryKey: rivenKeys.owned, queryFn: () => invoke("get_rivens") });
}

const NO_DISPOSITIONS: Readonly<Record<string, number>> = {};
export function useDispositions() {
  return (
    useQuery({ queryKey: rivenKeys.dispositions, queryFn: () => invoke("get_weapon_dispositions"), staleTime: Infinity }).data ?? NO_DISPOSITIONS
  );
}

/** Weapon uniqueName → display name, from the catalogue cache Relics also uses. */
export function useWeaponNames(): ReadonlyMap<string, string> {
  const { data } = useQuery({ queryKey: relicKeys.catalog, queryFn: () => invoke("get_all_items"), staleTime: Infinity });
  return useMemo(() => new Map((data ?? []).map((i) => [i.unique_name, i.name])), [data]);
}

/** Posts an unveiled riven on warframe.market (writes). */
export function usePostAuction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CommandArgs<"wfm_create_riven_auction">["params"]) => invokeWfm("wfm_create_riven_auction", { params }),
    onSuccess: () => {
      // warframe.market can take a moment to list it.
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: tradingKeys.auctions });
      }, 1500);
    },
  });
}

/** Lists unrevealed rivens as a regular sell order (writes). */
export function usePostVeiled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, platinum, quantity, visible }: { slug: string; platinum: number; quantity: number; visible: boolean }) => {
      const info = await invoke("wfm_get_item_info", { urlName: slug });
      if (!info?.id) throw new Error("Could not find the warframe.market item for this riven type.");
      return invokeWfm("wfm_create_order", { itemId: info.id, orderType: "sell", platinum, quantity, visible, modRank: null });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tradingKeys.orders });
    },
  });
}
