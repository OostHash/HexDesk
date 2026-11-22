import { ChevronRight, CircleCheck, CircleDashed, CircleDot, Hammer, type LucideIcon } from "lucide-react";
import { Button as AriaButton, Collection, Tree as AriaTree, TreeItem as AriaTreeItem, TreeItemContent, type Key } from "react-aria-components";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { strings } from "../strings";

export type TreeStatus = "owned" | "missing" | "craftable" | "partial";

export type TreeNode = {
  key: string;
  label: string;
  count?: number;
  /** Short trailing text instead of the count, e.g. "830 / 900". */
  detail?: string;
  status?: TreeStatus;
  children?: TreeNode[];
};

/** Status is shown as icon + text, never colour alone. */
const STATUS: Record<TreeStatus, { icon: LucideIcon; label: string; className: string }> = {
  owned: { icon: CircleCheck, label: strings.treeStatus.owned, className: "text-success" },
  craftable: { icon: Hammer, label: strings.treeStatus.craftable, className: "text-info" },
  partial: { icon: CircleDot, label: strings.treeStatus.partial, className: "text-warning" },
  missing: { icon: CircleDashed, label: strings.treeStatus.missing, className: "text-muted" },
};

type Props = {
  /** Accessible name of the tree. */
  label: string;
  nodes: readonly TreeNode[];
  expandedKeys?: ReadonlySet<string>;
  onExpandedChange?: (keys: Set<string>) => void;
  defaultExpandedKeys?: Iterable<string>;
  className?: string;
};

type Item = Omit<TreeNode, "children"> & { id: string; children?: Item[] };

const toItems = (nodes: readonly TreeNode[]): Item[] =>
  nodes.map(({ children, ...node }) => ({ ...node, id: node.key, ...(children ? { children: toItems(children) } : {}) }));

/**
 * Presentational tree on React Aria: role="treegrid", arrow keys
 * to move and expand/collapse, typeahead. The caller computes `status`
 * (e.g. recipe logic in screens/foundry); the tree only maps it to a role.
 */
export function Tree({ label, nodes, expandedKeys, onExpandedChange, defaultExpandedKeys, className }: Props) {
  const renderItem = (item: Item) => {
    const status = item.status ? STATUS[item.status] : undefined;
    return (
      <AriaTreeItem
        id={item.id}
        textValue={item.label}
        className={cn(
          "group cursor-default rounded-md text-sm text-text outline-none",
          "data-focus-visible:outline-2 data-focus-visible:outline-focus data-hovered:bg-hover",
        )}
      >
        <TreeItemContent>
          {({ hasChildItems, isExpanded, level }) => (
            <div className="flex h-control-sm items-center gap-1.5 pe-2" style={{ paddingInlineStart: `${String((level - 1) * 16 + 4)}px` }}>
              {hasChildItems ? (
                <AriaButton
                  slot="chevron"
                  // React Aria appends the row label: "Expand Chassis".
                  aria-label={isExpanded ? strings.collapse : strings.expand}
                  className="inline-flex size-5 items-center justify-center rounded-sm text-muted outline-none hover:text-text"
                >
                  <Icon
                    icon={ChevronRight}
                    size="xs"
                    className={cn("transition-transform motion-reduce:transition-none", isExpanded && "rotate-90")}
                  />
                </AriaButton>
              ) : (
                <span aria-hidden="true" className="size-5" />
              )}
              {status && <Icon icon={status.icon} size="xs" className={status.className} />}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail !== undefined ? (
                <span className="text-xs text-muted tabular-nums">{item.detail}</span>
              ) : (
                item.count !== undefined && <span className="text-xs text-muted tabular-nums">×{item.count}</span>
              )}
              {status && <span className={cn("text-xs", status.className)}>{status.label}</span>}
            </div>
          )}
        </TreeItemContent>
        {item.children && <Collection items={item.children}>{renderItem}</Collection>}
      </AriaTreeItem>
    );
  };

  const keySet = (keys: Set<Key>) => new Set([...keys].map(String));

  return (
    <AriaTree
      aria-label={label}
      items={toItems(nodes)}
      {...(expandedKeys ? { expandedKeys } : {})}
      {...(defaultExpandedKeys ? { defaultExpandedKeys } : {})}
      {...(onExpandedChange
        ? {
            onExpandedChange: (keys: Set<Key>) => {
              onExpandedChange(keySet(keys));
            },
          }
        : {})}
      className={cn("flex flex-col gap-px outline-none", className)}
    >
      {renderItem}
    </AriaTree>
  );
}
