import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../cn";

type Props = Omit<ComponentProps<"input">, "type" | "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The visible label. Leave it out only when a label elsewhere points at the switch's id. */
  children?: ReactNode;
};

/** Native checkbox with role="switch", drawn as a track with a thumb. */
export function Switch({ checked, onCheckedChange, id, className, children, ...rest }: Props) {
  // Browsers want an id or name on every form field.
  const fallbackId = useId();
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-text has-disabled:opacity-50", className)}>
      <input
        id={id ?? fallbackId}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => {
          onCheckedChange(event.target.checked);
        }}
        className={cn(
          "relative h-5 w-9 shrink-0 appearance-none rounded-full border border-border-strong bg-field",
          "transition-colors motion-reduce:transition-none checked:border-accent checked:bg-accent",
          "before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-muted before:transition-transform",
          "motion-reduce:before:transition-none checked:before:translate-x-4 checked:before:bg-on-accent",
          "forced-colors:appearance-auto",
        )}
        {...rest}
      />
      {children}
    </label>
  );
}
