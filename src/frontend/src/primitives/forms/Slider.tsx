import type { ComponentProps } from "react";
import { cn } from "../cn";
import { useFieldControl } from "./FormField";

type Props = Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  value: number;
  /** Every step while the thumb moves. */
  onValueChange: (value: number) => void;
  /** Once the pointer is released or a key step ends, for changes too heavy to apply while dragging. */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shown next to the track and used as aria-valuetext. */
  formatValue?: (value: number) => string;
};

/** Native range input; the browser provides keyboard steps and value semantics. */
export function Slider({ value, onValueChange, onValueCommit, min, max, step = 1, formatValue, id, className, ...rest }: Props) {
  const field = useFieldControl({ id });
  const text = formatValue?.(value);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => {
          onValueChange(Number(event.target.value));
        }}
        onPointerUp={(event) => {
          onValueCommit?.(Number(event.currentTarget.value));
        }}
        onKeyUp={(event) => {
          onValueCommit?.(Number(event.currentTarget.value));
        }}
        className="h-control-sm min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
        {...field}
        {...rest}
      />
      {text !== undefined && (
        <output htmlFor={field.id} className="w-12 shrink-0 text-end text-sm text-muted tabular-nums">
          {text}
        </output>
      )}
    </div>
  );
}
