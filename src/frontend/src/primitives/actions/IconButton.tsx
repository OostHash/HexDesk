import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../cn";
import { Icon } from "../display/Icon";

const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none " +
    "disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-muted hover:bg-hover hover:text-text aria-pressed:text-accent",
        solid: "border border-border bg-surface text-text hover:bg-hover aria-pressed:border-accent aria-pressed:bg-selected",
        danger: "text-muted hover:bg-danger/10 hover:text-danger",
      },
      // sm stays at 24px: the WCAG 2.2 minimum target size (2.5.8).
      size: { sm: "size-6", md: "size-control-md", lg: "size-control-lg" },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type Props = Omit<ComponentProps<"button">, "children" | "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    icon: LucideIcon;
    /** Required accessible name; also shown as the native tooltip. */
    label: string;
    /** Toggle state (e.g. pin/unpin). Sets aria-pressed. */
    pressed?: boolean;
  };

export function IconButton({ icon, label, pressed, variant, size, type = "button", className, title, ...rest }: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...rest}
    >
      <Icon icon={icon} size={size === "lg" ? "md" : "sm"} />
    </button>
  );
}
