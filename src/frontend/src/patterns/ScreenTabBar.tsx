import type { ReactNode } from "react";

/**
 * The tab strip at the top of a screen. It is 44px high, like the modular
 * window header beside it, so their bottom lines meet across the window.
 */
export function ScreenTabBar({ children }: { children: ReactNode }) {
  return <div className="flex h-11 shrink-0 items-end border-b border-border bg-bg px-4 lg:px-6">{children}</div>;
}
