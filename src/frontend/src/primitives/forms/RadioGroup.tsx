import { useId, type ReactNode } from "react";
import { cn } from "../cn";

type Option<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

type Props<T extends string> = {
  legend: ReactNode;
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<Option<T>>;
  /** "list": stacked native radios. "segmented": a row of pills (e.g. a mode switch). */
  appearance?: "list" | "segmented";
  /** Visually hide the legend while keeping it as the group's accessible name. */
  hideLegend?: boolean;
  name?: string;
  className?: string;
};

/**
 * Native radio group in a fieldset: arrow keys, one tab stop and the group
 * name come from the browser. Use it instead of button rows that act as
 * radios (e.g. the fissure watch form).
 */
export function RadioGroup<T extends string>({
  legend,
  value,
  onValueChange,
  options,
  appearance = "list",
  hideLegend = false,
  name,
  className,
}: Props<T>) {
  const generated = useId();
  const groupName = name ?? generated;
  const segmented = appearance === "segmented";

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className={cn("mb-1 text-xs font-medium text-muted", hideLegend && "sr-only")}>{legend}</legend>
      <div className={cn(segmented ? "flex flex-wrap gap-1" : "flex flex-col gap-1.5")}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex items-center gap-2 text-sm text-text has-disabled:opacity-50",
              segmented &&
                "h-control-sm rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-text " +
                  "has-checked:border-accent has-checked:bg-selected has-checked:text-text has-focus-visible:outline-2 has-focus-visible:outline-focus",
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => {
                onValueChange(option.value);
              }}
              className={cn(segmented ? "sr-only" : "size-4 shrink-0 accent-accent")}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
