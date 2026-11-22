import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "./invoke";

/**
 * The settings file. Only the keys a screen owns are typed here; everything else is kept as-is. The backend
 * merges saved keys into the file, so a save never touches other settings.
 */
export type SettingsFile = Readonly<Record<string, unknown>>;

export const settingsKeys = { all: ["settings"] as const };

function parse(json: string): SettingsFile {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as SettingsFile) : {};
  } catch {
    return {};
  }
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: async () => parse(await invoke("load_settings")),
    staleTime: Infinity,
  });
}

const saveSettings = (patch: SettingsFile) => invoke("save_settings", { json: JSON.stringify(patch) });

/**
 * Saves some top-level keys. Updates the cache optimistically, so a toggle
 * reacts immediately; on failure the cache is restored. The settings-updated
 * event (TauriEventBridge) refreshes every window afterwards.
 */
export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.all });
      const previous = queryClient.getQueryData<SettingsFile>(settingsKeys.all);
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      queryClient.setQueryData(settingsKeys.all, context?.previous);
    },
  });
}

/**
 * Saves some top-level keys and updates the cache only once the save succeeded. For saves that change which
 * screen is shown, such as finishing the welcome screen, where an optimistic update would unmount the screen
 * that reports a failure.
 */
export function useSaveSettingsConfirmed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (_result, patch) => {
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, (current = {}) => ({ ...current, ...patch }));
    },
  });
}

export const ocrModelsMutationKey = ["settings", "ocr-models"] as const;

/** Allows the ocrs models (downloading them first) or stops using them. */
export function useOcrModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ocrModelsMutationKey,
    mutationFn: (enabled: boolean) => invoke("set_ocr_models", { enabled }),
    onSuccess: (_result, enabled) => {
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, (current = {}) => ({ ...current, ocrModels: enabled }));
    },
  });
}
