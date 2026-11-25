import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { Spinner } from "../display/Spinner";
import { strings } from "../strings";

/**
 * A busy button is disabled but keeps its full colour: the spinner already
 * says it is working, and a dimmed accent turns muddy on light pages.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none " +
    "transition-colors motion-reduce:transition-none disabled:opacity-50 " +
    "aria-busy:cursor-progress aria-busy:opacity-100",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent/90 active:bg-accent/80",
        secondary: "border border-border bg-surface text-text hover:bg-hover active:bg-active",
        ghost: "text-muted hover:bg-hover hover:text-text active:bg-active",
        danger: "bg-danger text-on-danger hover:bg-danger/90 active:bg-danger/80",
      },
      size: {
        sm: "h-control-sm px-2 text-xs",
        md: "h-control-md px-3 text-sm",
        lg: "h-control-lg px-4 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type Props = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    leadingIcon?: LucideIcon;
    trailingIcon?: LucideIcon;
  };

/** Native <button>. type defaults to "button" so it never submits a form by accident. */
export function Button({
  variant,
  size,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" label={strings.busy} className="text-current" /> : leadingIcon && <Icon icon={leadingIcon} />}
      {children}
      {trailingIcon && <Icon icon={trailingIcon} />}
    </button>
  );
}
