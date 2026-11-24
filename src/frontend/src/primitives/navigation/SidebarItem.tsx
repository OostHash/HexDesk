import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn";
import { Icon, type IconSize } from "../display/Icon";

type Props = Omit<ComponentProps<"button">, "children"> & {
  active: boolean;
  label: ReactNode;
  icon?: LucideIcon;
  /** Defaults to sm; a sidebar that can show icons only uses a larger size. */
  iconSize?: IconSize;
  /** Small count shown at the end, e.g. items in a category. */
  count?: number;
  /** Free slot after the label, e.g. a Badge. */
  badge?: ReactNode;
  /**
   * A red dot on the icon, for something that needs the user (an update).
   * It is not announced; put the reason in the accessible name too.
   */
  dot?: boolean;
};

/**
 * Category/navigation entry for a sidebar list. Put it in <nav><ul><li>.
 * The active entry gets aria-current="page".
 */
export function SidebarItem({ active, label, icon, iconSize = "sm", count, badge, dot = false, className, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-control-md w-full items-center gap-2 rounded-md border-s-2 px-3 text-start text-sm transition-colors motion-reduce:transition-none",
        active ? "border-accent bg-selected text-text" : "border-transparent text-muted hover:bg-hover hover:text-text",
        className,
      )}
      {...rest}
    >
      {icon &&
        (dot ? (
          // A div, not a span: icon-only sidebars hide the label by hiding span children.
          <div className="relative shrink-0">
            <Icon icon={icon} size={iconSize} />
            <div aria-hidden="true" className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-surface" />
          </div>
        ) : (
          <Icon icon={icon} size={iconSize} />
        ))}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
      {count !== undefined && <span className="text-xs text-muted tabular-nums">{count}</span>}
    </button>
  );
}
