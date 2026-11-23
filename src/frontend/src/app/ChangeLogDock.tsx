import { ExternalLink } from "lucide-react";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useGameState } from "../api/app";
import { closeChangelogPopout, focusMainWindow, openChangelogPopout, useChangelogPopout } from "../api/changelogPopout";
import { isTauri } from "../api/env";
import { onEvent } from "../api/events";
import { useSettings } from "../api/settings";
import { imageSources, useImageBaseUrl } from "../api/catalog";
import { useChangeLog } from "../api/inventory";
import { openExternal } from "../api/links";
import { useCatalogByUniqueName } from "../api/relics";
import { useClock } from "../api/statistics";
import {
  batchCounts,
  changeKey,
  describeChange,
  FEED_STEP_MS,
  filterChanges,
  formatChangeTime,
  formatClockTime,
  latestBatch,
  LOG_HEIGHT,
  maxLogHeight,
  startsBatch,
  type LogItem,
} from "../domain/changelog";
import type { ChangeEntry } from "../domain/inventory";
import type { ClockFormat } from "../domain/statistics";
import { wikiUrl } from "../domain/wiki";
import { ItemImage } from "../patterns/ItemImage";
import { WikiMenu } from "../patterns/WikiMenu";
import { IconButton } from "../primitives/actions";
import { ResizeHandle } from "../primitives/behavior/ResizeHandle";
import { cn } from "../primitives/cn";
import { Badge } from "../primitives/display";
import { SearchInput } from "../primitives/forms";
import { toast } from "../primitives/overlay";
import { showItem, showRecent } from "../state/inventoryFilters";

const EMPTY: readonly ChangeEntry[] = [];
const NO_KEYS: ReadonlySet<string> = new Set();

function subscribeResize(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => {
    window.removeEventListener("resize", listener);
  };
}
const useWindowHeight = () => useSyncExternalStore(subscribeResize, () => window.innerHeight);

export type RowContext = {
  lookup: (uniqueName: string) => LogItem | undefined;
  baseUrl: string | undefined;
  clock: ClockFormat;
  locale: string;
  onItem: (name: string) => void;
  onCategory: (category: string) => void;
};

/**
 * One change: time, item, rank, category, old → new quantity and the amount.
 * In the collapsed feed it has no wiki menu; in the list a right-click opens it.
 */
export function ChangeRow({ change, ctx, feed = false }: { change: ChangeEntry; ctx: RowContext; feed?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const item = ctx.lookup(change.unique_name);
  const { name, category } = describeChange(change, item);
  const up = change.delta > 0;
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-sm"
      onContextMenu={
        feed
          ? undefined
          : (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
      }
    >
      <span className="min-w-24 shrink-0 text-xs whitespace-nowrap text-muted tabular-nums max-[800px]:hidden">
        {formatChangeTime(change.timestamp, ctx.clock, ctx.locale)}
      </span>
      <ItemImage size="sm" sources={imageSources(item?.image_name ?? undefined, ctx.baseUrl)} name={name} />
      <button
        type="button"
        title={`Show ${name} in Inventory`}
        className="pointer-events-auto min-w-0 truncate text-start font-medium hover:text-accent hover:underline"
        onClick={() => {
          ctx.onItem(name);
        }}
      >
        {name}
      </button>
      {change.rank != null && <Badge tone="accent">R{change.rank}</Badge>}
      <button
        type="button"
        title={`Show recent ${category} changes in Inventory`}
        className="pointer-events-auto max-w-32 shrink-0 truncate text-xs font-semibold tracking-wide text-muted uppercase hover:text-accent hover:underline"
        onClick={() => {
          ctx.onCategory(category);
        }}
      >
        {category}
      </button>
      <span className="ms-auto flex min-w-40 shrink-0 items-center justify-end gap-1.5 tabular-nums">
        {change.old_qty !== undefined && change.new_qty !== undefined && (
          <span className="text-xs text-muted">
            {change.old_qty.toLocaleString()} → {change.new_qty.toLocaleString()}
          </span>
        )}
        <span className={cn("flex items-center gap-1 font-semibold", up ? "text-success" : "text-danger")}>
          <span className="sr-only">{up ? "Increased by " : "Decreased by "}</span>
          <span aria-hidden="true" className="text-base leading-none">
            {up ? "↑" : "↓"}
          </span>
          <span className="text-xs">{Math.abs(change.delta).toLocaleString()}</span>
        </span>
      </span>
      {!feed && (
        <WikiMenu
          name={name}
          url={wikiUrl(name)}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onOpen={(url) => void openExternal(url).catch(() => undefined)}
        />
      )}
    </div>
  );
}

/** Row context: catalogue lookup, images, clock, and what a click on a name or category does. */
export function useRowContext(onItem: (name: string) => void, onCategory: (category: string) => void): RowContext {
  const catalog = useCatalogByUniqueName();
  const baseUrl = useImageBaseUrl();
  const { clock, locale } = useClock();
  return { lookup: (uniqueName) => catalog.get(uniqueName), baseUrl, clock, locale, onItem, onCategory };
}

/** Keys that stay with their change when new changes arrive above it; repeats get a counter. */
function rowKeys(changes: readonly ChangeEntry[]): string[] {
  const seen = new Map<string, number>();
  return changes.map((change) => {
    const key = changeKey(change);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key}#${String(count)}`;
  });
}

/** Search plus every change, newest batch first; the dock and the pop-out both show it. */
export function ChangeLogList({
  changes,
  ctx,
  id,
  className,
  arriving = NO_KEYS,
}: {
  changes: readonly ChangeEntry[];
  ctx: RowContext;
  id?: string;
  className?: string;
  /** Changes that just came in while the list is open; they slide in. */
  arriving?: ReadonlySet<string>;
}) {
  const [search, setSearch] = useState("");
  const visible = filterChanges(changes, ctx.lookup, search);
  const keys = rowKeys(visible);
  return (
    <div id={id} className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="border-b border-border px-3 py-1.5">
        <SearchInput size="sm" label="Search changes" placeholder="Search changes…" value={search} onValueChange={setSearch} />
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">{search ? "No matching changes." : "No changes recorded yet."}</p>
      ) : (
        <ul aria-label="Changes" className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((change, index) => (
            <li
              key={keys[index]}
              className={cn(
                // Alternate row shading so a time and its item read as one line.
                "overflow-hidden border-b border-border/40 px-3 py-1 even:bg-surface-sunken/40",
                startsBatch(visible, index) && "border-t-2 border-t-border",
                arriving.has(changeKey(change)) && "motion-safe:animate-row-arrive",
              )}
            >
              <ChangeRow change={change} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  /** Switches the shell to Inventory; the dock sets its filters first. */
  onOpenInventory: () => void;
};

/**
 * The changelog along the bottom of the main window. The whole bar opens and
 * closes it. Collapsed it shows the newest batch as a feed, open it lists
 * every change with search, and each name or category opens Inventory on it.
 */
export function ChangeLogDock({ onOpenInventory }: Props) {
  const changeQuery = useChangeLog();
  const changes = changeQuery.data ?? EMPTY;
  const { popout, loaded, setPopout } = useChangelogPopout();
  const { data: settings } = useSettings();
  const { scannedAt } = useGameState();
  const windowHeight = useWindowHeight();
  const listId = useId();

  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState<number>(LOG_HEIGHT.initial);

  const batch = useMemo(() => latestBatch(changes), [changes]);
  const batchKey = batch.map(changeKey).join("|");
  const counts = batchCounts(batch);

  // The batch present when the log first loads is history, not an arrival.
  const [baseline, setBaseline] = useState<string | null>(null);
  if (changeQuery.isSuccess && baseline === null) setBaseline(batchKey);
  const arrived = baseline !== null && batchKey !== "" && batchKey !== baseline;

  // A new batch runs as a feed while collapsed (one change per step) and
  // slides into the list while open.
  const [feed, setFeed] = useState<{ key: string; index: number } | null>(null);
  const [fedKey, setFedKey] = useState<string | null>(null);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(NO_KEYS);
  if (arrived && fedKey !== batchKey) {
    setFedKey(batchKey);
    setFeed(expanded ? null : { key: batchKey, index: 0 });
    setArriving(expanded ? new Set(batch.map(changeKey)) : NO_KEYS);
  }
  useEffect(() => {
    if (!feed || expanded) return;
    const id = window.setTimeout(() => {
      setFeed((f) => (f && f.index + 1 < batch.length ? { ...f, index: f.index + 1 } : null));
    }, FEED_STEP_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [feed, expanded, batch.length]);
  const feedIndex = !expanded && feed?.key === batchKey ? feed.index : undefined;
  const feedChange = feedIndex === undefined ? undefined : batch[feedIndex];

  const ctx = useRowContext(
    (name) => {
      showItem(name);
      onOpenInventory();
    },
    (category) => {
      showRecent(category);
      onOpenInventory();
    },
  );
  const { clock, locale } = ctx;

  // In its own window (changelogPopout): this dock opens and closes it, like the modular window.
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    if (!popout) {
      void closeChangelogPopout().catch(() => undefined);
      return;
    }
    openChangelogPopout(settings, () => {
      // The user closed the window: dock the changelog again.
      setPopout(false);
    }).catch((error: unknown) => {
      setPopout(false);
      toast({ title: "Could not open the changelog window", description: String(error), tone: "danger" });
    });
    // Only the switch opens or closes the window; settings are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout, loaded]);

  // Names and categories clicked in the pop-out open Inventory here.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onEvent("changelog-open-inventory", ({ item, category }) => {
      if (item !== undefined) showItem(item);
      else showRecent(category);
      onOpenInventory();
      void focusMainWindow().catch(() => undefined);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onOpenInventory]);

  if (popout) return null;

  const maxHeight = maxLogHeight(windowHeight);
  const shownHeight = Math.min(height, maxHeight);

  return (
    <section
      aria-label="Changelog"
      className={cn("relative flex shrink-0 flex-col border-t border-border bg-surface", expanded && "shadow-dock-up")}
      style={expanded ? { height: shownHeight } : undefined}
    >
      {expanded && (
        <ResizeHandle
          label="Changelog height"
          axis="y"
          direction={-1}
          value={shownHeight}
          min={LOG_HEIGHT.min}
          max={maxHeight}
          onValueChange={setHeight}
          className="absolute inset-x-0 top-0 z-(--hex-z-sticky) h-1.5"
        />
      )}
      <div
        className={cn(
          "group relative flex h-11 shrink-0 items-center gap-2.5 px-3 text-sm font-semibold tracking-wide text-muted uppercase hover:text-text",
          expanded && "border-b border-border",
        )}
      >
        {/* The whole bar opens and closes the list; the controls on it sit above this button. */}
        <button
          type="button"
          aria-label="Changelog"
          aria-expanded={expanded}
          aria-controls={listId}
          className="absolute inset-0 cursor-pointer"
          onClick={() => {
            setExpanded((v) => !v);
            setFeed(null);
            setArriving(NO_KEYS);
          }}
        />
        {/* All text on the bar is one link to recent changes in Inventory; the rest of the bar toggles the list. */}
        <button
          type="button"
          title="Show recent changes in Inventory"
          className="group/text relative inline-flex min-h-6 shrink-0 items-center gap-2.5 uppercase hover:text-text"
          onClick={() => {
            showRecent();
            onOpenInventory();
          }}
        >
          <span className="group-hover/text:underline">Changelog</span>
          <span role="status" className="flex items-center gap-1.5 normal-case empty:hidden">
            {arrived && (counts.up > 0 || counts.down > 0) && (
              <span key={batchKey} className="flex items-center gap-1.5 motion-safe:animate-fade-in">
                {counts.up > 0 && (
                  <span className="text-success">
                    +{counts.up}
                    <span className="sr-only"> increased</span>
                  </span>
                )}
                {counts.down > 0 && (
                  <span className="text-danger">
                    −{counts.down}
                    <span className="sr-only"> decreased</span>
                  </span>
                )}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="font-normal">
            ·
          </span>
          <span className="font-normal tracking-normal normal-case">
            last scan {scannedAt === null ? "not yet" : formatClockTime(scannedAt, clock, locale)}
          </span>
        </button>
        <div className="pointer-events-none relative ms-auto w-[min(680px,calc(100%-250px))] min-w-0 font-normal tracking-normal text-text normal-case max-[480px]:hidden">
          {feedChange && (
            <div key={`${batchKey}:${String(feedIndex)}`} className="motion-safe:animate-feed-step">
              <ChangeRow change={feedChange} ctx={ctx} feed />
            </div>
          )}
        </div>
        <IconButton
          size="lg"
          icon={ExternalLink}
          label="Open in its own window"
          className="relative"
          onClick={() => {
            if (isTauri()) setPopout(true);
            else toast({ title: "Only in the desktop app", description: "The changelog opens in its own window in the desktop app.", tone: "info" });
          }}
        />
      </div>
      {expanded && <ChangeLogList changes={changes} ctx={ctx} id={listId} arriving={arriving} />}
    </section>
  );
}
