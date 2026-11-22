import { Bug, PanelLeftClose, PanelLeftOpen, Settings, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { usePendingUpdate } from "../api/app";
import { openExternal } from "../api/links";
import { cn } from "../primitives/cn";
import { Icon, type IconSize } from "../primitives/display";
import { SidebarItem } from "../primitives/navigation";
import { Tooltip, type TooltipTriggerProps } from "../primitives/overlay";
import { HexDeskMark } from "../patterns/HexDeskMark";
import { useNavCollapsed } from "./navCollapsed";

export type NavScreen = { id: string; label: string; icon: LucideIcon };

const BUG_REPORT_URL = "https://github.com/OostHash/HexDesk/issues/new/choose";

// Narrow windows always get icons only; the collapse toggle decides for wider ones.
const ICON_ONLY_ITEM = "justify-center gap-3 px-0 [&>span]:hidden";
const RESPONSIVE_ITEM = "justify-center gap-3 px-0 md:justify-start md:px-3 [&>span]:hidden md:[&>span]:inline";

/** Screens are the main navigation; support and settings sit smaller below them. */
const ITEM_KIND = {
  screen: { iconSize: "xl", className: "h-14 text-lg" },
  secondary: { iconSize: "lg", className: "h-10 text-sm" },
} as const satisfies Record<string, { iconSize: IconSize; className: string }>;

/** The label is already the accessible name; aria-describedby would only repeat it. */
function withoutDescription({ style, onPointerEnter, onPointerLeave, onFocus, onBlur }: TooltipTriggerProps) {
  return { style, onPointerEnter, onPointerLeave, onFocus, onBlur };
}

type ItemProps = Omit<ComponentProps<typeof SidebarItem>, "label" | "icon" | "aria-label" | "className"> & {
  label: string;
  icon: LucideIcon;
  kind: keyof typeof ITEM_KIND;
  collapsed: boolean;
  /** Something waiting here (an update): a red dot, and the reason in the name and tooltip. */
  alert?: string;
};

/** A navigation entry that names itself in a tooltip whenever its label is hidden. */
function NavItem({ label, icon, kind, collapsed, alert, ...rest }: ItemProps) {
  const name = alert ? `${label}, ${alert}` : label;
  return (
    <Tooltip content={name} placement="right" delay={150} className={collapsed ? "" : "md:hidden"}>
      {(trigger) => (
        <SidebarItem
          {...rest}
          {...withoutDescription(trigger)}
          label={label}
          icon={icon}
          iconSize={ITEM_KIND[kind].iconSize}
          dot={alert !== undefined}
          aria-label={name}
          className={cn(collapsed ? ICON_ONLY_ITEM : RESPONSIVE_ITEM, ITEM_KIND[kind].className)}
        />
      )}
    </Tooltip>
  );
}

type Props = {
  screens: readonly NavScreen[];
  current: string;
  onSelect: (id: string) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
};

/** The main window's sidebar: screens, then support and settings at the bottom. */
export function MainNav({ screens, current, onSelect, settingsOpen, onOpenSettings }: Props) {
  const [collapsed, setCollapsed] = useNavCollapsed();
  const update = usePendingUpdate();
  const toggleLabel = collapsed ? "Expand navigation" : "Collapse navigation";
  return (
    <nav
      aria-label="Main"
      data-collapsed={collapsed || undefined}
      className={cn("flex w-20 shrink-0 flex-col gap-4 border-e border-border bg-surface p-2", !collapsed && "md:w-64")}
    >
      <div className={cn("flex items-center justify-center gap-2.5 pt-1 text-xl font-semibold", !collapsed && "md:justify-start md:px-2")}>
        <HexDeskMark className="size-12 text-accent" />
        <span className={cn("hidden", !collapsed && "md:inline")}>HexDesk</span>
      </div>
      {/* Only the screens scroll in a short window, so Report a bug and Settings stay reachable. */}
      <ul className="scrollbar-thin flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {screens.map((s) => (
          <li key={s.id}>
            <NavItem
              active={current === s.id}
              label={s.label}
              icon={s.icon}
              kind="screen"
              collapsed={collapsed}
              onClick={() => {
                onSelect(s.id);
              }}
            />
          </li>
        ))}
      </ul>
      {/* The empty space between the lists is the toggle. Narrow windows are always collapsed, so it is hidden there. */}
      <Tooltip content={toggleLabel} placement="right" delay={150}>
        {(trigger) => (
          <button
            type="button"
            aria-label={toggleLabel}
            className="group hidden min-h-control-md flex-1 items-end justify-center rounded-md pb-1 text-muted hover:text-text md:flex"
            onClick={() => {
              setCollapsed(!collapsed);
            }}
            {...withoutDescription(trigger)}
          >
            <Icon
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              size="md"
              className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>
        )}
      </Tooltip>
      <ul aria-label="Support and settings" className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
        <li>
          <NavItem
            active={false}
            label="Report a bug"
            icon={Bug}
            kind="secondary"
            collapsed={collapsed}
            onClick={() => {
              void openExternal(BUG_REPORT_URL).catch(() => undefined);
            }}
          />
        </li>
        <li>
          <NavItem
            active={settingsOpen}
            label="Settings"
            icon={Settings}
            kind="secondary"
            collapsed={collapsed}
            {...(update ? { alert: "update available" } : {})}
            onClick={onOpenSettings}
          />
        </li>
      </ul>
    </nav>
  );
}
