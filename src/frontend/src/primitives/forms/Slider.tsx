import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "../cn";
import { useFieldControl } from "./FormField";

type Props = Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  value: number;
  /** Every step while the thumb moves. */
  onValueChange: (value: number) => void;
  /**
   * When the browser commits a value: on release after a drag or a track click, and after each keyboard step.
   * For changes too heavy to apply while dragging.
   */
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
  const input = useRef<HTMLInputElement>(null);
  const commit = useRef(onValueCommit);
  useEffect(() => {
    commit.current = onValueCommit;
  });
  // React's onChange follows the input event, every step of a drag. The
  // native change event fires once the value is committed, whatever the
  // input device.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const committed = () => {
      commit.current?.(Number(element.value));
    };
    element.addEventListener("change", committed);
    return () => {
      element.removeEventListener("change", committed);
    };
  }, []);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        ref={input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => {
          onValueChange(Number(event.target.value));
        }}
        className="h-control-sm min-w-0 flex-1 accent-accent"
        {...field}
        {...rest}
      />
      {text !== undefined && (
        <output htmlFor={field.id} className="min-w-12 shrink-0 whitespace-nowrap text-end text-sm text-muted tabular-nums">
          {text}
        </output>
      )}
    </div>
  );
}
