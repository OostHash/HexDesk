import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "../cn";

type Props = Omit<ComponentProps<"input">, "type" | "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  indeterminate?: boolean;
  children: ReactNode;
};

/** Native checkbox with its label; accent-color carries the theme. */
export function Checkbox({ checked, onCheckedChange, indeterminate = false, id, className, children, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // Browsers want an id or name on every form field.
  const fallbackId = useId();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-text has-disabled:opacity-50", className)}>
      <input
        ref={ref}
        id={id ?? fallbackId}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onCheckedChange(event.target.checked);
        }}
        className="size-4 shrink-0 accent-accent"
        {...rest}
      />
      {children}
    </label>
  );
}
