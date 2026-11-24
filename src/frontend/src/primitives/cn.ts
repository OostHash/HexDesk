import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts (last one wins), so a
 * caller's layout class can override a primitive default deterministically.
 * tailwind-merge must know our own theme names (theme/index.css).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg",
        "panel",
        "nav",
        "surface",
        "surface-raised",
        "surface-sunken",
        "field",
        "border",
        "border-strong",
        "text",
        "muted",
        "faint",
        "accent",
        "accent-soft",
        "on-accent",
        "on-danger",
        "success",
        "danger",
        "warning",
        "info",
        "hover",
        "active",
        "selected",
        "backdrop",
        "focus",
        "tone",
      ],
      spacing: ["control-sm", "control-md", "control-lg", "cell-x", "cell-y"],
      text: ["list"],
      shadow: ["1", "2", "3"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
