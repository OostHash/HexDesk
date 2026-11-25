import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../cn";
import { Icon } from "./Icon";

const BASE =
  "inline-flex h-control-sm shrink-0 items-center gap-1 rounded-full border text-xs whitespace-nowrap transition-colors motion-reduce:transition-none";

type ToggleProps = {
  /** Filter chip: a toggle button (aria-pressed). */
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onRemove?: never;
  removeLabel?: never;
};

type RemovableProps = {
  /** Removable chip: text plus a remove button (e.g. a saved watch). */
  onRemove: () => void;
  /** Accessible name of the remove button. */
  removeLabel: string;
  active?: never;
  onActiveChange?: never;
};

type Props = (ToggleProps | RemovableProps) & {
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

export function Chip(props: Props) {
  const { disabled = false, className, children } = props;

  if (props.onRemove) {
    return (
      <span className={cn(BASE, "border-border bg-surface ps-2.5 pe-0.5 text-text", disabled && "opacity-50", className)}>
        {children}
        <button
          type="button"
          aria-label={props.removeLabel}
          disabled={disabled}
          onClick={props.onRemove}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger"
        >
          <Icon icon={X} size="xs" />
        </button>
      </span>
    );
  }

  const { active, onActiveChange } = props;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => {
        onActiveChange(!active);
      }}
      className={cn(
        BASE,
        "px-2.5 disabled:opacity-50",
        active ? "border-accent bg-selected text-text" : "border-border text-muted hover:bg-hover hover:text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}
