import { ChevronDown, Star } from "lucide-react";
import { useId, type ReactNode } from "react";
import { IconButton } from "../../../primitives/actions";
import { cn } from "../../../primitives/cn";
import { Badge, Card, Icon } from "../../../primitives/display";
import type { StateTone } from "../stateTones";

type PinProps = { pinned: boolean; onTogglePin: () => void; name: string };

function PinButton({ pinned, onTogglePin, name }: PinProps) {
  return (
    <IconButton
      icon={Star}
      size="sm"
      pressed={pinned}
      label={pinned ? `Unpin ${name}` : `Pin ${name} to the modular window`}
      className={cn(pinned && "text-warning [&_svg]:fill-current")}
      onClick={onTogglePin}
    />
  );
}

type TileProps = {
  name: string;
  state: string;
  tone: StateTone;
  countdown: string;
  /** e.g. "until Night". */
  detail?: string;
  pin?: PinProps | undefined;
};

/** A world timer: name, countdown, state badge and an optional pin. */
export function TimerTile({ name, state, tone, countdown, detail, pin }: TileProps) {
  return (
    <li>
      <Card padding="sm" className="h-full">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
          <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">{countdown}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone.tone} style={tone.style}>
            {state}
          </Badge>
          {detail && <span className="min-w-0 flex-1 truncate text-xs text-muted">{detail}</span>}
          {pin && (
            <span className="ms-auto">
              <PinButton {...pin} />
            </span>
          )}
        </div>
      </Card>
    </li>
  );
}

type ExpandableProps = TileProps & {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** False: cannot open (e.g. Baro is away); shows `collapsedDetail` instead. */
  expandable?: boolean;
  collapsedDetail?: ReactNode;
  children: ReactNode;
};

/**
 * Timer tile with a disclosure for details (sortie missions, Baro's
 * inventory). A real button with aria-expanded. Expanded tiles span the full row.
 */
export function ExpandableTile({
  name,
  state,
  tone,
  countdown,
  pin,
  expanded,
  onExpandedChange,
  expandable = true,
  collapsedDetail,
  children,
}: ExpandableProps) {
  const bodyId = useId();
  const open = expandable && expanded;
  return (
    <li className={cn(open && "col-span-full")}>
      <Card padding="sm" className={cn("h-full", open && "border-accent/40", !expandable && "opacity-75")}>
        <div className="flex items-center gap-2">
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => {
                onExpandedChange(!open);
              }}
              className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-start text-sm font-semibold hover:text-accent"
            >
              <span className="truncate">{name}</span>
              <Icon
                icon={ChevronDown}
                size="xs"
                className={cn("text-muted transition-transform motion-reduce:transition-none", !open && "-rotate-90")}
              />
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
          )}
          <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums">{countdown}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone.tone} style={tone.style}>
            {state}
          </Badge>
          {!open && collapsedDetail && <span className="min-w-0 flex-1 truncate text-xs text-muted">{collapsedDetail}</span>}
          {pin && (
            <span className="ms-auto">
              <PinButton {...pin} />
            </span>
          )}
        </div>
        {open && (
          <div id={bodyId} className="border-t border-border pt-2">
            {children}
          </div>
        )}
      </Card>
    </li>
  );
}
