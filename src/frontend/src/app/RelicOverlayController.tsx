import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { isTauri } from "../api/env";
import { onEvent } from "../api/events";
import { hideRewardStrip, logRelic, overlayPrefsFrom, setOverlayStatus, showRewardStrip, syncOverlaySwitches } from "../api/overlays";
import { useSettings } from "../api/settings";
import { STRIP } from "../domain/relicReward";
import { getPreferences } from "../state/preferences";

/** How long a backend status line stays in the header. */
export const STATUS_MS = 4000;

/**
 * Main window: tells the backend which overlays may run, and places the relic
 * reward window over the game when the reward screen opens. The overlay
 * window draws the cards itself.
 */
export function RelicOverlayController() {
  const queryClient = useQueryClient();
  const { data: settings, isSuccess } = useSettings();
  const prefs = overlayPrefsFrom(settings);

  // Latest switches for the event handlers below.
  const current = useRef(prefs);
  useEffect(() => {
    current.current = prefs;
  });

  const {
    overlaysEnabled,
    rewardEnabled,
    relicPickEnabled,
    rivenEnabled,
    overlayManual,
    overlayKey,
    testingKeys,
    overlayKeyCapture,
    overlayScreenshot,
    overlayAreas,
  } = prefs;
  const testingCorrectKey = testingKeys.correct;
  const testingWrongKey = testingKeys.wrong;
  useEffect(() => {
    if (!isSuccess || !isTauri()) return;
    syncOverlaySwitches({
      ...current.current,
      overlaysEnabled,
      rewardEnabled,
      relicPickEnabled,
      rivenEnabled,
      overlayManual,
      overlayKey,
      testingKeys: { correct: testingCorrectKey, wrong: testingWrongKey },
      overlayKeyCapture,
      overlayScreenshot,
      overlayAreas,
    }).catch((error: unknown) => {
      console.error("overlays: syncing switches failed", error);
    });
  }, [
    isSuccess,
    overlaysEnabled,
    rewardEnabled,
    relicPickEnabled,
    rivenEnabled,
    overlayManual,
    overlayKey,
    testingCorrectKey,
    testingWrongKey,
    overlayKeyCapture,
    overlayScreenshot,
    overlayAreas,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (p: Promise<() => void>) => {
      void p.then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      });
    };
    let run = 0;
    let visible = false;
    let statusTimer: number | undefined;
    const enabled = () => current.current.overlaysEnabled && current.current.rewardEnabled;
    const hide = () => {
      run += 1;
      visible = false;
      void hideRewardStrip();
    };
    const place = (strip: { top: number; height: number }, label: string) => {
      const mine = ++run;
      const isCurrent = () => mine === run && current.current.overlaysEnabled;
      void showRewardStrip(strip, getPreferences().textScale, isCurrent, label)
        .then((shown) => {
          if (shown) visible = true;
        })
        .catch(() => undefined);
    };

    keep(
      onEvent("relic-trigger", () => {
        if (enabled()) place(STRIP.trigger, "relic-trigger");
      }),
    );
    keep(
      onEvent("relic-rewards", (rewards) => {
        if (!rewards || rewards.items.length === 0) {
          hide();
          return;
        }
        if (enabled()) void logRelic(`[APP] relic-rewards: ${String(rewards.items.length)} items, overlayVisible=${String(visible)}`);
        // Normally the trigger placed the window already; rewards can come first.
        if (enabled() && !visible) place(STRIP.rewards, "relic-rewards fallback");
      }),
    );
    keep(onEvent("relic-screen", hide));
    keep(onEvent("overlays-disabled", hide));
    keep(
      onEvent("status-line", (text) => {
        setOverlayStatus(queryClient, text);
        window.clearTimeout(statusTimer);
        statusTimer = window.setTimeout(() => {
          setOverlayStatus(queryClient, "");
        }, STATUS_MS);
      }),
    );
    return () => {
      disposed = true;
      window.clearTimeout(statusTimer);
      for (const fn of unlisteners) fn();
    };
  }, [queryClient]);

  return null;
}
