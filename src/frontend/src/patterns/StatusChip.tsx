import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../primitives/cn";

export type StatusState = "online" | "warn" | "offline" | "disabled";

const chip = cva("inline-flex h-control-sm shrink-0 items-center gap-1.5 rounded-md border bg-surface px-2 text-xs whitespace-nowrap", {
  variants: {
    state: {
      online: "border-success/40",
      warn: "border-warning/40",
      offline: "border-border",
      disabled: "border-border",
    },
    interactive: {
      true: "transition-colors hover:bg-hover motion-reduce:transition-none",
      false: "",
    },
  },
});

const DOT: Record<StatusState, string> = {
  online: "bg-success",
  warn: "bg-warning",
  offline: "bg-faint",
  disabled: "bg-faint",
};

const DETAIL: Record<StatusState, string> = {
  online: "text-success",
  warn: "text-warning",
  offline: "text-muted",
  disabled: "text-muted",
};

type Props = Omit<ComponentProps<"button">, "children" | "title"> & {
  label: string;
  /** The status in words; colour only repeats it (WCAG 1.4.1). */
  detail: string;
  state: StatusState;
  /** Longer explanation, shown on hover. */
  hint: string;
};

/**
 * Connection or data status in the header: dot, label, detail. A button when
 * it has an action (onClick or a popover target), plain text otherwise.
 */
export function StatusChip({ label, detail, state, hint, className, onClick, popoverTarget, ...rest }: Props) {
  const content = (
    <>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[state])} />
      <span className="font-medium text-muted">{label}</span>
      {/* Spoken as "Memory: No Game"; visually the dot and spacing separate them. */}
      <span className="sr-only">: </span>
      <span className={DETAIL[state]}>{detail}</span>
    </>
  );
  if (onClick || popoverTarget) {
    return (
      <button
        type="button"
        title={hint}
        onClick={onClick}
        popoverTarget={popoverTarget}
        className={cn(chip({ state, interactive: true }), className)}
        {...rest}
      >
        {content}
      </button>
    );
  }
  return (
    <span title={hint} className={cn(chip({ state, interactive: false }), className)} style={rest.style}>
      {content}
    </span>
  );
}
