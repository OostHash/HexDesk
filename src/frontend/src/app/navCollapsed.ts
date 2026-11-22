import { useState } from "react";

export const NAV_COLLAPSED_KEY = "hexdesk-nav";

/** Collapsed unless the user expanded it: icons leave the most room for the screens. */
export function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) !== "expanded";
  } catch {
    return true;
  }
}

/** Whether the main navigation shows icons only, remembered between sessions. */
export function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(readNavCollapsed);
  const set = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Storage full or blocked: the choice still holds for this session.
    }
  };
  return [collapsed, set] as const;
}
