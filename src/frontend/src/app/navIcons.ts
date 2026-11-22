import { createLucideIcon, type LucideIcon } from "lucide-react";
import foundry from "../assets/navigation/foundry.svg?raw";
import inventory from "../assets/navigation/inventory.svg?raw";
import market from "../assets/navigation/market.svg?raw";
import relics from "../assets/navigation/relics.svg?raw";
import rivens from "../assets/navigation/rivens.svg?raw";
import timers from "../assets/navigation/timers.svg?raw";

/** The navigation SVGs are drawn on a 256 grid; lucide renders on a 24 grid. */
const SOURCE_GRID = 256;
const LUCIDE_GRID = 24;

/**
 * Turns a single-path, filled 256x256 SVG into a lucide component, so it works
 * everywhere a lucide icon does (Icon, SidebarItem). Lucide icons are
 * stroked; these are filled shapes, so the path swaps fill and stroke.
 */
export function filledIcon(name: string, svg: string): LucideIcon {
  const d = /\sd="([^"]+)"/.exec(svg)?.[1];
  if (!d) throw new Error(`Navigation icon "${name}" has no path`);
  return createLucideIcon(name, [
    [
      "path",
      {
        d,
        transform: `scale(${String(LUCIDE_GRID / SOURCE_GRID)})`,
        fill: "currentColor",
        stroke: "none",
        fillRule: "evenodd",
        key: "glyph",
      },
    ],
  ]);
}

/** Icons for the screens in the main navigation. */
export const NAV_ICONS = {
  inventory: filledIcon("inventory", inventory),
  foundry: filledIcon("foundry", foundry),
  relics: filledIcon("relics", relics),
  rivens: filledIcon("rivens", rivens),
  timers: filledIcon("timers", timers),
  market: filledIcon("market", market),
} as const satisfies Record<string, LucideIcon>;
