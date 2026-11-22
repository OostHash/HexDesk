import { useSaveSettings, useSettings } from "../../api/settings";
import { watchesFrom, type FissureWatch } from "../../domain/fissures";
import { normalizeFavorites, type TimerId } from "../../domain/timers";

/**
 * Timer favourites, fissure watches and the notification switch, read from
 * and written to the shared settings file.
 */
export function useTimerPreferences() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();

  const rawFavorites = settings?.timerFavorites;
  const favorites = normalizeFavorites(Array.isArray(rawFavorites) ? rawFavorites.filter((v): v is string => typeof v === "string") : []);
  const watches = watchesFrom(settings?.fissureWatches);
  const notificationsEnabled = settings?.fissureNotifications !== false;

  return {
    favorites,
    watches,
    notificationsEnabled,
    toggleFavorite: (id: TimerId) => {
      const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
      save.mutate({ timerFavorites: next });
    },
    addWatch: (watch: Omit<FissureWatch, "id">) => {
      save.mutate({ fissureWatches: [...watches, { ...watch, id: String(Date.now()) }] });
    },
    removeWatch: (id: string) => {
      save.mutate({ fissureWatches: watches.filter((w) => w.id !== id) });
    },
    setNotificationsEnabled: (enabled: boolean) => {
      save.mutate({ fissureNotifications: enabled });
    },
  };
}
