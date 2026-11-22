import { useQuery } from "@tanstack/react-query";
import { invoke } from "./invoke";

export const worldstateKeys = { all: ["worldstate"] as const };

/** The backend caches worldstate; the frontend polls it once a minute. */
export const WORLDSTATE_POLL_MS = 60_000;

/**
 * Worldstate for every consumer in this window (Timers, modular window,
 * fissure alerts). One query key means one poll and one shared snapshot.
 */
export function useWorldState() {
  return useQuery({
    queryKey: worldstateKeys.all,
    queryFn: () => invoke("fetch_worldstate"),
    refetchInterval: WORLDSTATE_POLL_MS,
    refetchIntervalInBackground: true,
  });
}
