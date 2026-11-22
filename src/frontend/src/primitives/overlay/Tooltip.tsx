import { useEffect, useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { cn } from "../cn";
import { anchoredStyle, anchorStyle, useAnchorName, type Placement } from "./anchor";

export type TooltipTriggerProps = {
  "aria-describedby": string;
  style: CSSProperties;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
};

type Props = {
  content: ReactNode;
  /** Render the trigger (an interactive element) and spread the props on it. */
  children: (props: TooltipTriggerProps) => ReactNode;
  placement?: Placement;
  /** Hover delay in ms; focus shows immediately. */
  delay?: number;
  /** Extra classes for the tooltip panel, e.g. to hide it at some widths. */
  className?: string;
};

/** Show/hide logic outside React state: the popover element is the state. */
function createController(id: string, delay: number) {
  let timer: number | undefined;
  const panel = () => document.getElementById(id);
  const clear = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const show = () => {
    clear();
    const el = panel();
    if (el && !el.matches(":popover-open")) el.showPopover();
  };
  const hide = () => {
    clear();
    const el = panel();
    if (el?.matches(":popover-open")) el.hidePopover();
  };
  const showLater = () => {
    clear();
    timer = window.setTimeout(show, delay);
  };
  return { show, hide, showLater, clear };
}

/**
 * Supplementary description on hover and keyboard focus (role="tooltip",
 * aria-describedby). Uses popover="hint" so it never closes an open menu or
 * popover. Escape hides it. Never put interactive content in a tooltip.
 */
export function Tooltip({ content, children, placement = "top", delay = 400, className }: Props) {
  const id = useId();
  const anchor = useAnchorName();
  const controller = useMemo(() => createController(id, delay), [id, delay]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") controller.hide();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      controller.clear();
    };
  }, [controller]);

  return (
    <>
      {children({
        "aria-describedby": id,
        style: anchorStyle(anchor),
        onPointerEnter: controller.showLater,
        onPointerLeave: controller.hide,
        onFocus: controller.show,
        onBlur: controller.hide,
      })}
      <div
        id={id}
        role="tooltip"
        popover="hint"
        style={anchoredStyle(anchor, placement)}
        className={cn("pointer-events-none max-w-xs rounded-md bg-text px-2 py-1 text-xs text-bg shadow-2", className)}
      >
        {content}
      </div>
    </>
  );
}
