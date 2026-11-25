import { CircleCheck } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useRecipes, useRelicDrops, useRelicNames } from "../../api/foundry";
import { useOwnership } from "../../api/inventory";
import { useCatalogList, useLivePrices, useWfmLookup } from "../../api/market";
import { useSettings } from "../../api/settings";
import { ownedRelicsFor } from "../../domain/foundry";
import { sellFromSetting } from "../../domain/inventory";
import { buildSets, requiredCounts, setParts, setValue, summarizeSet, type PrimeSet, type SetContext, type SetValue } from "../../domain/market";
import { fmt } from "../../patterns/MarketBadges";
import { NAV_ICONS } from "../../patterns/navIcons";
import { cn } from "../../primitives/cn";
import { openItemInfo, type InfoSection } from "../../state/itemInfo";
import { Badge, domainTone, Icon } from "../../primitives/display";

const EMPTY_RECIPES = new Map();

/** Which relics drop a part (relic paths) and their display names. */
export type RelicLookup = {
  drops: Readonly<Record<string, readonly string[]>>;
  names: ReadonlyMap<string, string>;
};

/** Every prime set, and what the set cards and the set info window need to show them. */
export function useSetData() {
  const catalog = useCatalogList();
  const { ownership: own } = useOwnership();
  const lookup = useWfmLookup();
  const { prices } = useLivePrices();
  const relicDrops = useRelicDrops();
  const relicNames = useRelicNames();
  const relics: RelicLookup = useMemo(() => ({ drops: relicDrops, names: relicNames }), [relicDrops, relicNames]);
  const sets = useMemo(() => buildSets(catalog.data ?? []), [catalog.data]);
  const parentIds = useMemo(() => sets.flatMap((s) => (s.parent ? [s.parent.unique_name] : [])), [sets]);
  const recipes = useRecipes(parentIds) ?? EMPTY_RECIPES;
  const required = useMemo(() => requiredCounts(recipes.values()), [recipes]);
  const { data: settings } = useSettings();
  const storedSellFrom = settings?.sellFrom;
  const sellFrom = useMemo(() => sellFromSetting(storedSellFrom), [storedSellFrom]);
  const ctx: SetContext = useMemo(() => ({ own, sellFrom, required, lookup, prices }), [own, sellFrom, required, lookup, prices]);
  return { sets, ctx, relics, isPending: catalog.isPending };
}

function ValueCell({ label, best, children }: { label: string; best: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-faint">{label}</dt>
      <dd className={cn("flex items-center gap-1 tabular-nums", best ? "font-semibold text-success" : "text-text")}>
        {children}
        {best && (
          <>
            <CircleCheck aria-hidden="true" className="size-3" />
            <span className="sr-only">, best</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The set price, and what one set's worth of owned parts fetches as parts and
 * in ducats once you own any.
 */
export function SetValueLine({ value, complete, loading, name }: { value: SetValue; complete: boolean; loading: boolean; name: string }) {
  const plat = (n: number | null, missing: string) => (n === null ? <span title={missing}>{loading ? "…" : "—"}</span> : `${fmt(n)}p`);
  return (
    <dl aria-label={`Selling ${name}`} className="mt-auto grid w-full grid-cols-3 gap-2 border-t border-border pt-2 text-start text-xs">
      <ValueCell label="As set" best={value.best === "set"}>
        {plat(value.set, "No market price for the set")}
      </ValueCell>
      {value.ducats > 0 && (
        <>
          <ValueCell label={complete ? "As parts" : "Owned parts"} best={value.best === "parts"}>
            {plat(value.parts, "Not every part has a market price")}
          </ValueCell>
          <ValueCell label="Ducats" best={false}>
            {fmt(value.ducats)}
          </ValueCell>
        </>
      )}
    </dl>
  );
}

/**
 * A part's ducats or price, marked when it is the better way to get rid of a
 * copy. Marked and plain values take the same box, so the columns stay put.
 */
function TradeCell({
  value,
  unit,
  tone,
  marked,
  title,
}: {
  value: number | null;
  unit: "ducats" | "platinum";
  tone: "ducat" | "price-platinum";
  marked: boolean;
  title: string | undefined;
}) {
  if (value === null) return <span className="justify-self-end px-1.5 text-faint">—</span>;
  return (
    <span
      title={title}
      className={cn("justify-self-end rounded-sm px-1.5 py-px text-tone tabular-nums", marked && "bg-(--hex-tone)/15 font-medium")}
      style={domainTone(tone)}
    >
      {unit === "platinum" ? `${fmt(value)}p` : fmt(value)}
      <span className="sr-only">
        {unit === "ducats" ? " ducats" : ""}
        {marked ? (unit === "ducats" ? ", better for ducats than selling" : ", better to sell") : ""}
      </span>
    </span>
  );
}

const tradeTitle = (ducats: number | null, price: number | null, sellFrom: number | null, better: "ducats" | "plat" | null) =>
  ducats === null || price === null || sellFrom === null
    ? undefined
    : `${fmt(ducats)} ducats for ${fmt(price)}p, sell from ${fmt(sellFrom)}p: ${better === "ducats" ? "better for ducats" : "better to sell"}`;

/** "Lith S19 Intact" → "Lith S19". */
const relicLabel = (name: string) => name.replace(/ (Intact|Exceptional|Flawless|Radiant)$/, "");

const RELICS_IN_TITLE = 6;

const nameList = (names: readonly string[]) =>
  names.length <= RELICS_IN_TITLE
    ? names.join(", ")
    : `${names.slice(0, RELICS_IN_TITLE).join(", ")} and ${String(names.length - RELICS_IN_TITLE)} more`;

/**
 * Stands in for the count of a part you do not own: a relic in green when a
 * relic you own drops it, in grey when it drops only from relics you lack.
 */
function MissingPart({ id, own, relics }: { id: string; own: SetContext["own"]; relics: RelicLookup }) {
  const all = [...new Set((relics.drops[id] ?? []).map((r) => relicLabel(relics.names.get(r) ?? r.split("/").pop() ?? r)))].sort();
  if (all.length === 0) {
    return (
      <span className="justify-self-center text-faint">
        <span aria-hidden="true">—</span>
        <span className="sr-only">none owned</span>
      </span>
    );
  }
  const owned = ownedRelicsFor(id, relics.drops, relics.names, own);
  const title = owned.length > 0 ? `Your relics: ${nameList(owned)}` : `Drops from ${nameList(all)}; you own none of them`;
  return (
    <span title={title} className={cn("justify-self-center", owned.length > 0 ? "text-success" : "text-faint")}>
      <Icon icon={NAV_ICONS.relics} size="sm" />
      <span className="sr-only">None owned. {title}</span>
    </span>
  );
}

export type SetPart = ReturnType<typeof setParts>[number];

export const setImage = (set: PrimeSet) => set.parent?.image_name ?? set.parts[0]?.image_name ?? null;

/** Opens the item info window on a set: its parts, what selling it is worth, market and wiki. */
export function openSetInfo(set: PrimeSet) {
  openItemInfo({
    uniqueName: set.parent?.unique_name ?? `set:${set.name}`,
    name: `${set.name} Set`,
    imageName: setImage(set),
    category: "Prime set",
    set: set.name,
  });
}

/** Opens the item info window on one part of a set: the relics that drop it, market and wiki. */
export function openPartInfo(set: PrimeSet, part: SetPart) {
  openItemInfo({
    uniqueName: part.item.unique_name,
    name: part.item.name,
    imageName: part.item.image_name ?? setImage(set),
    category: part.item.category,
  });
}

/** A set's parts: ducats and price (the better deal marked) and how many you own. */
export function SetPartsTable({
  set,
  ctx,
  relics,
  onOpenPart,
}: {
  set: PrimeSet;
  ctx: SetContext;
  relics: RelicLookup;
  onOpenPart: (part: SetPart) => void;
}) {
  return (
    <ul aria-label={`Parts of ${set.name}`} className="flex w-full flex-col divide-y divide-border/60 border-t border-border text-start text-xs">
      {setParts(set, ctx).map((p) => (
        <li key={p.item.unique_name}>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              onOpenPart(p);
            }}
            className="grid w-full grid-cols-[minmax(0,1fr)_3rem_2.5rem_1.75rem] items-center gap-2 rounded-sm px-1 py-1 text-start hover:bg-hover"
          >
            <span className={cn("truncate", p.qty === 0 && "text-muted")}>{p.label}</span>
            <TradeCell
              value={p.item.ducats ?? null}
              unit="ducats"
              tone="ducat"
              marked={p.better === "ducats"}
              title={tradeTitle(p.item.ducats ?? null, p.price, p.sellFrom, p.better)}
            />
            <TradeCell
              value={p.price}
              unit="platinum"
              tone="price-platinum"
              marked={p.better === "plat"}
              title={tradeTitle(p.item.ducats ?? null, p.price, p.sellFrom, p.better)}
            />
            {p.qty === 0 ? (
              <MissingPart id={p.item.unique_name} own={ctx.own} relics={relics} />
            ) : (
              <Badge tone={p.qty > p.required ? "warning" : "success"} className="justify-self-center">
                {p.qty}
                <span className="sr-only"> owned</span>
              </Badge>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SetInfoParts({ name }: { name: string }) {
  const { sets, ctx, relics, isPending } = useSetData();
  const set = sets.find((s) => s.name === name);
  if (!set) return <p className="text-sm text-muted">{isPending ? "Loading parts…" : "No parts known for this set."}</p>;
  const summary = summarizeSet(set, ctx);
  const value = setValue(set, summary, ctx);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted">
        {fmt(summary.owned)} of {fmt(set.parts.length)} parts owned. Open a part for the relics that drop it.
      </p>
      <SetPartsTable
        set={set}
        ctx={ctx}
        relics={relics}
        onOpenPart={(part) => {
          openPartInfo(set, part);
        }}
      />
      <SetValueLine value={value} complete={summary.complete} loading={ctx.prices.size === 0} name={set.name} />
    </div>
  );
}

/** Item info window sections for prime sets, added by the app shell. */
export const SET_INFO_SECTIONS: readonly InfoSection[] = [
  {
    id: "parts",
    title: "Parts",
    appliesTo: ({ target }) => target.set !== undefined,
    render: ({ target }) => (target.set ? <SetInfoParts name={target.set} /> : null),
  },
];
