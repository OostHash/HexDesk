import { useId, type CSSProperties } from "react";

/**
 * Placements for CSS anchor positioning (position-area). Each has a flip
 * fallback so the overlay stays on screen near window edges.
 */
export const PLACEMENT = {
  bottom: { area: "bottom span-right", fallback: "flip-block" },
  "bottom-end": { area: "bottom span-left", fallback: "flip-block" },
  top: { area: "top span-right", fallback: "flip-block" },
  right: { area: "right span-bottom", fallback: "flip-inline" },
  left: { area: "left span-bottom", fallback: "flip-inline" },
} as const;

export type Placement = keyof typeof PLACEMENT;

/** A unique anchor name per trigger, e.g. --hex-anchor-r1. */
export function useAnchorName(): string {
  return `--hex-anchor-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function anchorStyle(name: string): CSSProperties {
  return { anchorName: name };
}

export function anchoredStyle(name: string, placement: Placement, gap = 4): CSSProperties {
  const { area, fallback } = PLACEMENT[placement];
  return {
    positionAnchor: name,
    positionArea: area,
    positionTryFallbacks: fallback,
    margin: gap,
  };
}
