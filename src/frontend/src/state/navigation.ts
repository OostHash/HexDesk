import { useSyncExternalStore } from "react";

/**
 * Lets a screen send the main window to another screen. The app shell
 * listens and switches; the target screen reads what to show when it mounts.
 */

type ScreenListener = (screen: string) => void;
const screenListeners = new Set<ScreenListener>();

/** Shows a screen of the main window by its id ("rivens", "foundry"…). */
export function openScreen(screen: string) {
  for (const listener of screenListeners) listener(screen);
}

/** Calls `listener` for every `openScreen`; returns the unsubscribe function. */
export function onOpenScreen(listener: ScreenListener): () => void {
  screenListeners.add(listener);
  return () => {
    screenListeners.delete(listener);
  };
}

let rivenFocus: string | null = null;
const focusListeners = new Set<() => void>();

const setRivenFocus = (id: string | null) => {
  rivenFocus = id;
  for (const listener of focusListeners) listener();
};

/** Opens the Rivens screen on My rivens at the riven with this item id. */
export function openRiven(itemId: string) {
  setRivenFocus(itemId);
  openScreen("rivens");
}

/** Forgets the riven to open, so the Rivens screen opens as usual next time. */
export const clearRivenFocus = () => {
  setRivenFocus(null);
};

function subscribeFocus(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** The item id of the riven to open, or null. */
export function useRivenFocus(): string | null {
  return useSyncExternalStore(subscribeFocus, () => rivenFocus);
}
