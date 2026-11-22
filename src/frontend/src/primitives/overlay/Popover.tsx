import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "../cn";
import { anchoredStyle, anchorStyle, useAnchorName, type Placement } from "./anchor";

export type PopoverTriggerProps = {
  popoverTarget: string;
  style: CSSProperties;
};

type Props = {
  /** Render the trigger; spread the props on a native <button> (or Button). */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  /** Accessible name of the popover panel. */
  label: string;
  className?: string;
  children: ReactNode;
};

/**
 * Non-modal panel on the native Popover API, positioned with CSS anchor
 * positioning. The browser handles light dismiss (click outside,
 * Escape), stacking of nested popovers, the top layer and aria-expanded on
 * the trigger.
 */
export function Popover({ trigger, open, onOpenChange, placement = "bottom", label, className, children }: Props) {
  const id = useId();
  const anchor = useAnchorName();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = ref.current;
    if (!panel || open === undefined) return;
    const isOpen = panel.matches(":popover-open");
    if (open && !isOpen) panel.showPopover();
    if (!open && isOpen) panel.hidePopover();
  }, [open]);

  return (
    <>
      {trigger({ popoverTarget: id, style: anchorStyle(anchor) })}
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        onToggle={(event) => onOpenChange?.(event.newState === "open")}
        style={anchoredStyle(anchor, placement)}
        className={cn("max-w-sm rounded-lg border border-border bg-surface-raised p-3 text-sm text-text shadow-2", className)}
      >
        {children}
      </div>
    </>
  );
}
