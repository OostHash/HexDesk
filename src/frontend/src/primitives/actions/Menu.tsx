import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover as AriaPopover,
  Separator,
} from "react-aria-components";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { buttonVariants } from "./Button";

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: LucideIcon;
      onAction: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { id: string; separator: true };

type Props = {
  /** Content of the trigger button (text and/or icon). */
  trigger: ReactNode;
  /** Accessible name when the trigger has no text (icon-only). */
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger";
  triggerSize?: "sm" | "md" | "lg";
  items: readonly MenuEntry[];
  placement?: "bottom start" | "bottom end" | "top start" | "top end";
  /** Controlled open state, e.g. to open the menu from a right-click elsewhere. */
  open?: boolean;
  /** Called when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Action menu built on React Aria: role="menu", roving focus,
 * arrow keys, typeahead, Escape and focus restore to the trigger.
 */
export function Menu({
  trigger,
  triggerLabel,
  triggerVariant = "secondary",
  triggerSize = "md",
  items,
  placement = "bottom start",
  open,
  onOpenChange,
}: Props) {
  const disabledKeys = items.filter((item) => !("separator" in item) && item.disabled).map((item) => item.id);

  return (
    <MenuTrigger {...(open === undefined ? {} : { isOpen: open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <AriaButton
        {...(triggerLabel ? { "aria-label": triggerLabel } : {})}
        className={cn(buttonVariants({ variant: triggerVariant, size: triggerSize }), "data-pressed:bg-active")}
      >
        {trigger}
      </AriaButton>
      <AriaPopover
        placement={placement}
        offset={4}
        className="min-w-44 rounded-lg border border-border bg-surface-raised p-1 text-sm text-text shadow-2 outline-none"
      >
        <AriaMenu disabledKeys={disabledKeys} className="flex flex-col outline-none">
          {items.map((item) =>
            "separator" in item ? (
              <Separator key={item.id} className="my-1 h-px bg-border" />
            ) : (
              <AriaMenuItem
                key={item.id}
                id={item.id}
                textValue={item.label}
                onAction={item.onAction}
                className={cn(
                  "flex h-control-sm cursor-default items-center gap-2 rounded-md px-2 outline-none",
                  "data-disabled:opacity-50 data-focused:bg-hover",
                  item.danger ? "text-danger" : "text-text",
                )}
              >
                {item.icon && <Icon icon={item.icon} size="sm" />}
                {item.label}
              </AriaMenuItem>
            ),
          )}
        </AriaMenu>
      </AriaPopover>
    </MenuTrigger>
  );
}
