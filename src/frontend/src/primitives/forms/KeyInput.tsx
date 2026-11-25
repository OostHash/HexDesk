import { Keyboard, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { fieldVariants, type FieldSize } from "./fieldStyles";
import { useFieldControl } from "./FormField";

type Props = {
  /** How the current key is named. */
  value: string;
  /** The `KeyboardEvent.code` of the key pressed while capturing. Escape cancels instead. */
  onKey: (code: string) => void;
  /**
   * Makes "no key" a choice: an × in the field while a key is set, and Backspace while capturing. Leave it out
   * when a key is required.
   */
  onClear?: () => void;
  /** Whether a key is set; the × shows only then. */
  hasKey?: boolean;
  /** Accessible name of the ×, such as "Remove overlay key". */
  clearLabel?: string;
  size?: FieldSize;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/**
 * A field that takes the next key press: click it, then press a key. Escape or
 * leaving the field cancels. The key press itself does nothing else in the page.
 */
export function KeyInput({ value, onKey, onClear, hasKey = true, clearLabel = "Remove key", size, invalid, disabled, id, className }: Props) {
  const field = useFieldControl({ id, invalid });
  const [capturing, setCapturing] = useState(false);
  const clearable = onClear !== undefined;
  const prompt = clearable ? "Press a key… (Backspace for none)" : "Press a key…";
  return (
    <div className={cn("relative flex items-center", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={capturing}
        className={cn(
          fieldVariants({ size }),
          "flex items-center justify-between gap-2 border-border pe-8 text-start",
          capturing && "border-accent text-muted",
        )}
        onClick={() => {
          setCapturing(true);
        }}
        onBlur={() => {
          setCapturing(false);
        }}
        onKeyDown={(event) => {
          if (!capturing) return;
          event.preventDefault();
          event.stopPropagation();
          setCapturing(false);
          if (event.code === "Escape") return;
          if (event.code === "Backspace" && onClear) onClear();
          else onKey(event.code);
        }}
        {...field}
      >
        <span aria-live="polite" className="truncate">
          {capturing ? prompt : value}
        </span>
      </button>
      {clearable && hasKey && !capturing ? (
        <button
          type="button"
          aria-label={clearLabel}
          disabled={disabled}
          className="absolute end-1.5 inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text disabled:opacity-50"
          onClick={onClear}
        >
          <Icon icon={X} size="sm" />
        </button>
      ) : (
        <Icon icon={Keyboard} size="sm" className="pointer-events-none absolute end-2.5 text-muted" />
      )}
    </div>
  );
}
