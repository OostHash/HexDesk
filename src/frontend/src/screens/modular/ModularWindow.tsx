import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, PanelRightClose, Star, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useCraftableItems, useRecipes } from "../../api/foundry";
import { useOwnership } from "../../api/inventory";
import { useModularPrefs } from "../../api/modular";
import { useCatalogByUniqueName } from "../../api/relics";
import { useWorldState } from "../../api/worldstate";
import { tierTone } from "../../domain/fissures";
import { moveItem, trackedNeeds, trackedStatus, VARIANT_LABEL, watchedFissures, type SectionId, type TrackedStatus } from "../../domain/modular";
import { formatDuration, untilExpiry } from "../../domain/time";
import { getTimerInfo, TIMER_LABELS } from "../../domain/timers";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, domainTone, Icon } from "../../primitives/display";
import { RadioGroup } from "../../primitives/forms";
import { useNow } from "../../state/useNow";

type ListProps<T> = { items: readonly T[]; index: number; name: string; onMove: (next: T[]) => void };

/** Up and down for one row of a reorderable list. */
function MoveButtons<T>({ items, index, name, onMove }: ListProps<T>) {
  return (
    <span className="flex shrink-0">
      <IconButton
        size="sm"
        icon={ArrowUp}
        label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => {
          onMove(moveItem(items, index, -1));
        }}
      />
      <IconButton
        size="sm"
        icon={ArrowDown}
        label={`Move ${name} down`}
        disabled={index === items.length - 1}
        onClick={() => {
          onMove(moveItem(items, index, 1));
        }}
      />
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-center text-xs text-muted">{children}</p>;
}

/** Short labels for a narrow panel; the title carries the full sentence. */
const STATUS: Record<Exclude<TrackedStatus, "none">, { label: string; title: string; tone: "accent" | "success" }> = {
  owned: { label: "Owned", title: "You own this item", tone: "accent" },
  ready: { label: "Ready", title: "Every part is in hand: ready to build", tone: "success" },
  covered: { label: "Covered", title: "All resources are covered", tone: "success" },
};

// ── Sections ────────────────────────────────────────────────────────────────

function Tracking({ view }: { view: "missing" | "all" }) {
  const { prefs, setTracked } = useModularPrefs();
  const { ownership } = useOwnership();
  const craftable = useCraftableItems().data;
  const recipes = useRecipes(prefs.tracked);
  const names = useMemo(() => new Map((craftable ?? []).map((c) => [c.unique_name, c.name])), [craftable]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (prefs.tracked.length === 0) return <Empty>Star ☆ items in Foundry to track them.</Empty>;
  return (
    <ul className="flex flex-col">
      {prefs.tracked.map((id, index) => {
        const name = names.get(id);
        if (!name) return null;
        const recipe = recipes?.get(id);
        const needs = recipe ? trackedNeeds(id, recipe, ownership) : [];
        const status = trackedStatus(id, recipe, needs, ownership);
        const rows = view === "all" ? needs : needs.filter((n) => n.shortage > 0);
        const open = needs.length > 0 && !collapsed.has(id);
        const listId = `needs-${id}`;
        return (
          <li key={id} className="border-b-2 border-border/70 last:border-b-0">
            <div className="flex items-center gap-1 px-1 py-0.5 hover:bg-hover">
              <MoveButtons items={prefs.tracked} index={index} name={name} onMove={setTracked} />
              {needs.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  className="flex min-w-0 flex-1 items-center gap-1 text-start text-sm"
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    setCollapsed(next);
                  }}
                >
                  {open ? (
                    <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                  )}
                  <span className="truncate" title={name}>
                    {name}
                  </span>
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm" title={name}>
                  {name}
                </span>
              )}
              {status !== "none" && (
                <Badge tone={STATUS[status].tone} title={STATUS[status].title}>
                  {STATUS[status].label}
                </Badge>
              )}
              <IconButton
                size="sm"
                variant="danger"
                icon={X}
                label={`Stop tracking ${name}`}
                onClick={() => {
                  setTracked(prefs.tracked.filter((t) => t !== id));
                }}
              />
            </div>
            {open && (
              <ul id={listId} aria-label={`${name} needs`} className="border-t border-border/40 bg-surface-sunken py-1 ps-8 pe-2">
                {rows.length === 0 ? (
                  <li className="text-xs text-success">✓ All resources covered</li>
                ) : (
                  rows.map((r) => (
                    <li key={r.unique_name} className="flex items-center justify-between gap-1.5 py-0.5 text-xs">
                      <span className={cn("min-w-0 flex-1 truncate", r.shortage > 0 ? "text-text" : "text-muted")}>{r.name}</span>
                      <span className="flex shrink-0 items-center gap-1 tabular-nums">
                        <span className={r.shortage === 0 ? "text-success" : "text-danger"}>{r.owned.toLocaleString()}</span>
                        <span className="text-muted">/ {r.needed.toLocaleString()}</span>
                        {r.shortage > 0 && (
                          <Badge tone="danger">
                            <span className="sr-only">short </span>−{r.shortage.toLocaleString()}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Favorites() {
  const { prefs, setFavorites } = useModularPrefs();
  const { ownership } = useOwnership();
  const catalog = useCatalogByUniqueName();
  if (prefs.favorites.length === 0) return <Empty>Star ☆ items in Inventory to favorite them.</Empty>;
  return (
    <ul className="flex flex-col">
      {prefs.favorites.map((id, index) => {
        const item = catalog.get(id);
        if (!item) return null;
        return (
          <li key={id} className="flex items-center gap-1 border-b border-border/35 px-1 py-0.5 last:border-b-0 hover:bg-hover">
            <MoveButtons items={prefs.favorites} index={index} name={item.name} onMove={setFavorites} />
            <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
              {item.name}
            </span>
            <span className="shrink-0 text-sm font-semibold text-text tabular-nums">{(ownership.quantities[id] ?? 0).toLocaleString()}</span>
            <IconButton
              size="sm"
              icon={Star}
              pressed
              label={`Remove ${item.name} from favorites`}
              onClick={() => {
                setFavorites(prefs.favorites.filter((f) => f !== id));
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Timers() {
  const { prefs, setTimerFavorites } = useModularPrefs();
  const ws = useWorldState().data;
  const now = useNow(prefs.timerFavorites.length > 0);
  if (prefs.timerFavorites.length === 0) return <Empty>Pin ☆ timers in the Timers tab to show them here.</Empty>;
  return (
    <ul className="flex flex-col">
      {prefs.timerFavorites.map((id, index) => {
        const label = TIMER_LABELS[id];
        const info = ws ? getTimerInfo(id, ws, now) : null;
        return (
          <li key={id} className="flex items-center gap-1 border-b border-border/35 px-1 py-0.5 last:border-b-0 hover:bg-hover">
            <MoveButtons items={prefs.timerFavorites} index={index} name={label} onMove={setTimerFavorites} />
            <span className="min-w-0 flex-1 truncate text-sm" title={label}>
              {label}
            </span>
            {info && <Badge>{info.state}</Badge>}
            <span className="min-w-16 shrink-0 text-end text-xs font-semibold text-text tabular-nums">
              {info ? formatDuration(untilExpiry(info.expiry, now)) : "—"}
            </span>
            <IconButton
              size="sm"
              icon={Star}
              pressed
              label={`Unpin ${label}`}
              onClick={() => {
                setTimerFavorites(prefs.timerFavorites.filter((t) => t !== id));
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Fissures() {
  const { prefs } = useModularPrefs();
  const ws = useWorldState().data;
  const matched = useMemo(() => watchedFissures(ws, prefs.watches), [ws, prefs.watches]);
  const now = useNow(matched.length > 0);
  if (prefs.watches.length === 0) return <Empty>Add fissure watches in the Timers tab.</Empty>;
  if (matched.length === 0) return <Empty>No matching fissures active.</Empty>;
  return (
    <ul className="flex flex-col">
      {matched.map(({ fissure, variant }) => {
        const tone = tierTone(fissure.tier);
        return (
          <li key={`${variant}:${fissure.id}`} className="flex flex-col border-b border-border/35 px-2 py-1 last:border-b-0">
            <span className="flex items-center gap-1.5 text-sm">
              <Badge tone={tone ? "domain" : "neutral"} variant="outline" style={tone ? domainTone(tone) : undefined}>
                {fissure.tier}
              </Badge>
              <span className="min-w-0 flex-1 truncate">{fissure.missionType}</span>
              <span className="shrink-0 text-xs text-muted">{VARIANT_LABEL[variant]}</span>
              <span className="shrink-0 text-xs font-semibold text-text tabular-nums">{formatDuration(untilExpiry(fissure.expiry, now))}</span>
            </span>
            <span className="truncate text-xs text-muted">
              {fissure.enemy} {fissure.node}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Window ──────────────────────────────────────────────────────────────────

function Section({ id, index, count }: { id: SectionId; index: number; count: number }) {
  const { prefs, setSectionOrder } = useModularPrefs();
  const [view, setView] = useState<"missing" | "all">("missing");
  const headingId = useId();
  const title = { tracking: "Tracking", favorites: "Favorites", timers: "Timers", fissures: "Watched fissures" }[id];
  const size = { tracking: prefs.tracked.length, favorites: prefs.favorites.length, timers: prefs.timerFavorites.length, fissures: 0 }[id];
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col", index > 0 && "border-t border-border")}>
      <header className="flex items-center gap-1 py-1 ps-3 pe-1">
        <h2 id={headingId} className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {title}
          {size > 0 ? ` (${String(size)})` : ""}
        </h2>
        {id === "tracking" && size > 0 && (
          <RadioGroup
            legend="Show"
            hideLegend
            appearance="segmented"
            value={view}
            onValueChange={setView}
            options={[
              { value: "missing", label: "Missing" },
              { value: "all", label: "All" },
            ]}
          />
        )}
        <IconButton
          size="sm"
          icon={ArrowUp}
          label={`Move ${title} section up`}
          disabled={index === 0}
          onClick={() => {
            setSectionOrder(moveItem(prefs.sectionOrder, index, -1));
          }}
        />
        <IconButton
          size="sm"
          icon={ArrowDown}
          label={`Move ${title} section down`}
          disabled={index === count - 1}
          onClick={() => {
            setSectionOrder(moveItem(prefs.sectionOrder, index, 1));
          }}
        />
      </header>
      {id === "tracking" && <Tracking view={view} />}
      {id === "favorites" && <Favorites />}
      {id === "timers" && <Timers />}
      {id === "fissures" && <Fissures />}
    </section>
  );
}

type Props = {
  /** Docked in the main window: shows a pop-out button. */
  onPopout?: () => void;
  /** Docked in the main window: collapses the panel to a narrow rail. */
  onCollapse?: () => void;
  className?: string;
};

/** Tracked items, favourites, pinned timers and watched fissures. */
export function ModularWindow({ onPopout, onCollapse, className }: Props) {
  const { prefs } = useModularPrefs();
  return (
    <aside aria-label="Modular window" className={cn("flex min-h-0 min-w-0 flex-col bg-surface", className)}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border ps-3 pe-1">
        <span className="flex-1 text-sm font-semibold tracking-wide text-muted uppercase">Modular window</span>
        {onPopout && <IconButton size="lg" icon={ExternalLink} label="Open in its own window" onClick={onPopout} />}
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {prefs.sectionOrder.map((id, index) => (
          <Section key={id} id={id} index={index} count={prefs.sectionOrder.length} />
        ))}
      </div>
      {/* The whole bottom strip, level with the changelog bar, collapses the panel. */}
      {onCollapse && (
        <button
          type="button"
          aria-label="Collapse modular window"
          className="flex h-11 w-full shrink-0 items-center justify-end px-3 text-muted hover:text-text"
          onClick={onCollapse}
        >
          <Icon icon={PanelRightClose} size="md" />
        </button>
      )}
    </aside>
  );
}
