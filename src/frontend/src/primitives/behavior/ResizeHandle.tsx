import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "../cn";

type Props = {
  /** Accessible name, e.g. "Sidebar width". */
  label: string;
  value: number;
  min: number;
  max: number;
  axis: "x" | "y";
  /** 1: dragging right/down grows the value; -1: it shrinks it. */
  direction?: 1 | -1;
  /** Keyboard step in px (Shift: ×4). */
  step?: number;
  onValueChange: (value: number) => void;
  /** Called once when a drag or key press ends, e.g. to persist. */
  onValueCommit?: (value: number) => void;
  className?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Splitter between two panes: role="separator" with value semantics, pointer
 * drag (rAF-throttled, pointer capture) and arrow keys / Home / End. With
 * native webview zoom, pointer deltas need no --hex-scale correction.
 */
export function ResizeHandle({ label, value, min, max, axis, direction = 1, step = 8, onValueChange, onValueCommit, className }: Props) {
  const drag = useRef<{ start: number; startValue: number; latest: number } | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const coordinate = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // preventDefault stops text selection during the drag, but also the
    // default focus; focus explicitly so arrow keys work right after a click.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: coordinate(event), startValue: value, latest: value };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.latest = clamp(state.startValue + direction * (coordinate(event) - state.start), min, max);
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current) onValueChange(drag.current.latest);
    });
  };

  const endDrag = () => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    onValueChange(state.latest);
    onValueCommit?.(state.latest);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? step * 4 : step;
    const grow = axis === "x" ? ["ArrowRight"] : ["ArrowDown"];
    const shrink = axis === "x" ? ["ArrowLeft"] : ["ArrowUp"];
    let next: number | null = null;
    if (grow.includes(event.key)) next = value + direction * amount;
    else if (shrink.includes(event.key)) next = value - direction * amount;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    const clamped = clamp(next, min, max);
    onValueChange(clamped);
    onValueCommit?.(clamped);
  };

  // A focusable separator with aria-valuenow is an interactive widget (WAI-ARIA
  // "window splitter" pattern); jsx-a11y classifies every separator as static.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        "relative shrink-0 touch-none bg-transparent transition-colors hover:bg-accent/40 focus-visible:bg-accent/60",
        axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className,
      )}
    />
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
