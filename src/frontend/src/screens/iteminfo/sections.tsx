import { useState, type ReactNode } from "react";
import { formatChance, formatDrain, type ItemDetails, type ModDetails } from "../../domain/items";
import { Button } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import type { ItemInfoTarget } from "../../state/itemInfo";

/** What every section gets to work with. */
export type SectionContext = {
  target: ItemInfoTarget;
  /** Null for items without details (anything but mods and arcanes). */
  details: ItemDetails | null;
  rank: number;
  setRank: (rank: number) => void;
  /** Copies per rank from the scanner; undefined when none are owned. */
  copies: Readonly<Record<string, number>> | undefined;
};

/**
 * One block of the item info window. The window shows every section whose
 * `appliesTo` holds, in the order of SECTIONS, so adding information for a
 * kind of item is a new entry here, not a change to the window.
 */
export type InfoSection = {
  id: string;
  title: string;
  appliesTo: (ctx: SectionContext) => boolean;
  render: (ctx: SectionContext) => ReactNode;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Facts({ rows }: { rows: ReadonlyArray<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function modTraits(mod: ModDetails): string | null {
  const traits = [mod.augment && "Augment", mod.exilus && "Exilus", mod.utility && "Utility"].filter((t): t is string => !!t);
  return traits.length > 0 ? traits.join(", ") : null;
}

const overview: InfoSection = {
  id: "overview",
  title: "Overview",
  appliesTo: ({ details }) => details?.kind === "mod",
  render: ({ details, rank }) => {
    if (details?.kind !== "mod") return null;
    const drain = details.drain_by_rank[rank];
    const traits = modTraits(details);
    const rows: Array<[string, string]> = [];
    if (details.polarity) rows.push(["Polarity", capitalize(details.polarity)]);
    if (drain !== undefined) rows.push([drain < 0 ? `Capacity at rank ${String(rank)}` : `Drain at rank ${String(rank)}`, formatDrain(drain)]);
    rows.push(["Max rank", String(details.max_rank)]);
    if (details.compat) rows.push(["Fits", details.compat]);
    if (traits) rows.push(["Type", traits]);
    return <Facts rows={rows} />;
  },
};

const stats: InfoSection = {
  id: "stats",
  title: "Stats",
  appliesTo: ({ details }) => (details?.stats_by_rank.length ?? 0) > 0,
  render: ({ details, rank }) => {
    const entry = details?.stats_by_rank[Math.min(rank, details.stats_by_rank.length - 1)];
    if (!entry) return null;
    const note =
      entry.text_rank === null ? "Description, the same at every rank" : entry.text_rank !== rank ? `Text for rank ${String(entry.text_rank)}` : null;
    return (
      <div className="flex flex-col gap-1">
        <ul className="flex flex-col gap-0.5 text-sm">
          {entry.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
    );
  },
};

const copies: InfoSection = {
  id: "copies",
  title: "Your copies",
  appliesTo: ({ details, copies }) => details !== null && Object.values(copies ?? {}).some((n) => n > 0),
  render: ({ details, copies, rank, setRank }) => {
    const ranks = Object.entries(copies ?? {})
      .filter(([, n]) => n > 0)
      .map(([r, n]) => ({ rank: Number(r), count: n }))
      .sort((a, b) => a.rank - b.rank);
    return (
      <ul aria-label="Copies per rank" className="flex flex-wrap gap-1">
        {ranks.map((r) => {
          const label = r.rank === 0 ? "Unranked" : r.rank === details?.max_rank ? `Rank ${String(r.rank)} (max)` : `Rank ${String(r.rank)}`;
          return (
            <li key={r.rank}>
              <Button
                size="sm"
                variant={r.rank === rank ? "primary" : "secondary"}
                aria-pressed={r.rank === rank}
                onClick={() => {
                  setRank(r.rank);
                }}
              >
                {label} ×{fmt(r.count)}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  },
};

/** Drops shown before "Show all". */
const DROP_PREVIEW = 5;

function DropList({ details }: { details: ItemDetails }) {
  const [all, setAll] = useState(false);
  const shown = all ? details.drops : details.drops.slice(0, DROP_PREVIEW);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col text-sm">
        {shown.map((drop, i) => (
          <li key={`${drop.location}-${String(i)}`} className={cn("flex items-baseline gap-3 py-0.5", i > 0 && "border-t border-border")}>
            <span className="min-w-0 flex-1">
              {drop.location}
              {drop.variant && <span className="text-muted"> · {drop.variant}</span>}
            </span>
            {drop.rarity && <span className="text-xs text-muted">{drop.rarity}</span>}
            <span className="w-14 text-end tabular-nums">{formatChance(drop.chance)}</span>
          </li>
        ))}
      </ul>
      {details.drops.length > DROP_PREVIEW && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? "Show fewer" : `Show all ${fmt(details.drops.length)}`}
        </Button>
      )}
    </div>
  );
}

const drops: InfoSection = {
  id: "drops",
  title: "Where to get it",
  appliesTo: ({ details }) => (details?.drops.length ?? 0) > 0,
  render: ({ details }) => (details ? <DropList details={details} /> : null),
};

export const SECTIONS: readonly InfoSection[] = [overview, stats, copies, drops];
