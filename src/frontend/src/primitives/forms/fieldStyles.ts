import { cva } from "class-variance-authority";

/**
 * Focus on a text field: the global 2px focus outline drawn over the field's
 * own border (offset -1px) instead of 2px outside it, so you see one accent
 * line, not the accent border plus a second ring around it.
 */
export const FIELD_FOCUS = "focus-visible:border-accent focus-visible:outline-offset-[-1px]";

/**
 * Disabled field: a dashed border and no fill, so it does not read as an
 * empty field with a placeholder. The value stays readable in muted text.
 */
export const FIELD_DISABLED = "disabled:border-dashed disabled:bg-transparent disabled:text-muted disabled:hover:border-border";

/** Shared look of text-like controls (Input, SearchInput, Select, Textarea). */
export const fieldVariants = cva(
  "w-full min-w-0 rounded-md border bg-field text-text placeholder:text-faint " +
    "transition-colors motion-reduce:transition-none hover:border-border-strong " +
    `${FIELD_FOCUS} ${FIELD_DISABLED} ` +
    "aria-invalid:border-danger",
  {
    variants: {
      size: {
        sm: "h-control-sm px-2 text-xs",
        md: "h-control-md px-3 text-sm",
        lg: "h-control-lg px-3 text-sm",
      },
    },
    compoundVariants: [],
    defaultVariants: { size: "md" },
  },
);

export type FieldSize = "sm" | "md" | "lg";
