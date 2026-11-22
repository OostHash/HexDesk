import type { ComponentProps } from "react";
import { cn } from "../cn";
import { FIELD_FOCUS } from "./fieldStyles";
import { useFieldControl } from "./FormField";

type Props = ComponentProps<"textarea"> & { invalid?: boolean };

/** Native <textarea>; no auto-resize. */
export function Textarea({ invalid, id, required, rows = 3, className, ...rest }: Props) {
  const field = useFieldControl({ id, invalid, required });
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full min-w-0 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-text placeholder:text-faint",
        "hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        FIELD_FOCUS,
        className,
      )}
      {...field}
      {...rest}
    />
  );
}
