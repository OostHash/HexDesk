import type { LucideIcon } from "lucide-react";
import { cn } from "../cn";

const SIZE = { xs: "size-3", sm: "size-4", md: "size-5", lg: "size-6", xl: "size-10" } as const;

export type IconSize = keyof typeof SIZE;

type Props = {
  icon: LucideIcon;
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
  className?: string;
};

/** One icon set (lucide). Decorative by default; pass `label` when the icon carries meaning. */
export function Icon({ icon: Glyph, size = "sm", label, className }: Props) {
  return (
    <Glyph
      className={cn("shrink-0", SIZE[size], className)}
      strokeWidth={2}
      focusable={false}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
