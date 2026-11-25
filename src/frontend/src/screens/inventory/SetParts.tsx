import { CircleCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useRecipes, useRelicDrops, useRelicNames } from "../../api/foundry";
import { useOwnership } from "../../api/inventory";
import { useCatalogList, useLivePrices, useWfmLookup } from "../../api/market";
import { useCatalogIndex, useDropData } from "../../api/relics";
import { useSettings } from "../../api/settings";
import { ownedRelicsFor } from "../../domain/foundry";
import { sellFromSetting } from "../../domain/inventory";
import { buildSets, requiredCounts, setParts, setValue, summarizeSet, type PrimeSet, type SetContext, type SetValue } from "../../domain/market";
import { REFINEMENT_LABEL, REFINEMENTS, relicSources, type RelicSource } from "../../domain/relics";
import { fmt } from "../../patterns/MarketBadges";
import { NAV_ICONS } from "../../patterns/navIcons";
import { cn } from "../../primitives/cn";
import { openItemInfo, type InfoSection, type ItemInfoTarget } from "../../state/itemInfo";
import { Button } from "../../primitives/actions";
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

/** The item window target of a set; its name is the set's market name ("Ash Prime Set"). */
export const setTarget = (set: PrimeSet): ItemInfoTarget => ({
  uniqueName: set.parent?.unique_name ?? `set:${set.name}`,
  name: `${set.name} Set`,
  imageName: setImage(set),
  category: "Prime set",
  set: set.name,
});

/** Opens the item window on a set: what selling it is worth, its relics and its market. */
export function openSetInfo(set: PrimeSet) {
  openItemInfo(setTarget(set));
}

/** Opens the item window on one part of a set: the relics that drop it and its market. */
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

/** The set's value line in the Info tab: as a set, as parts and in ducats. */
function SetSelling({ name }: { name: string }) {
  const { sets, ctx, isPending } = useSetData();
  const set = sets.find((s) => s.name === name);
  if (!set) return <p className="text-sm text-muted">{isPending ? "Loading parts…" : "No parts known for this set."}</p>;
  const summary = summarizeSet(set, ctx);
  const value = setValue(set, summary, ctx);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted">
        {fmt(summary.owned)} of {fmt(set.parts.length)} parts owned{summary.vaulted ? " · vaulted" : ""}.
      </p>
      <SetValueLine value={value} complete={summary.complete} loading={ctx.prices.size === 0} name={set.name} />
    </div>
  );
}

/** Relics shown before "Show all". */
const SET_RELIC_PREVIEW = 8;

type SetRelic = {
  source: RelicSource;
  /** The set's parts this relic gives, with their rarity in it and how many you own. */
  parts: Array<{ label: string; rarity: string; qty: number }>;
};

function ownedText(owned: RelicSource["owned"]): string {
  if (owned.total === 0) return "None owned";
  return REFINEMENTS.filter((r) => owned[r] > 0)
    .map((r) => `${fmt(owned[r])} ${REFINEMENT_LABEL[r]}`)
    .join(" · ");
}

/** Per relic, which of the set's parts it gives: your relics first, then unvaulted, then the most parts. */
function SetRelics({ name }: { name: string }) {
  const { sets, ctx } = useSetData();
  const drops = useDropData();
  const { index } = useCatalogIndex();
  const [all, setAll] = useState(false);
  const set = sets.find((s) => s.name === name);
  const relics = useMemo(() => {
    if (!set) return [];
    const byRelic = new Map<string, SetRelic>();
    for (const part of setParts(set, ctx)) {
      for (const source of relicSources(part.item.name, drops.data ?? [], index, ctx.own)) {
        const entry = byRelic.get(source.relic.fullName) ?? { source, parts: [] };
        entry.parts.push({ label: part.label, rarity: source.rarity, qty: part.qty });
        byRelic.set(source.relic.fullName, entry);
      }
    }
    return [...byRelic.values()].sort(
      (a, b) =>
        Number(b.source.owned.total > 0) - Number(a.source.owned.total > 0) ||
        Number(a.source.vaulted === true) - Number(b.source.vaulted === true) ||
        b.parts.length - a.parts.length ||
        a.source.relic.fullName.localeCompare(b.source.relic.fullName),
    );
  }, [set, ctx, drops.data, index]);
  if (relics.length === 0) return <p className="text-sm text-muted">{drops.isPending ? "Loading relics…" : "No relic drops this set's parts."}</p>;
  const shown = all ? relics : relics.slice(0, SET_RELIC_PREVIEW);
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Relics that drop its parts" className="flex flex-col text-sm">
        {shown.map(({ source, parts }, i) => (
          <li key={source.relic.fullName} className={cn("flex flex-col gap-0.5 py-1", i > 0 && "border-t border-border")}>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1 font-medium">
                {source.relic.fullName}
                {source.vaulted === true && (
                  <Badge className="ms-2" size="sm">
                    Vaulted
                  </Badge>
                )}
              </span>
              <span className={cn("text-xs tabular-nums", source.owned.total > 0 ? "text-success" : "text-muted")}>{ownedText(source.owned)}</span>
            </span>
            <span className="text-xs text-muted">
              {parts.map((p, j) => (
                <span key={p.label}>
                  {j > 0 && " · "}
                  <span className={cn(p.qty === 0 && "text-text")}>{p.label}</span> ({p.rarity})
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {relics.length > SET_RELIC_PREVIEW && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? "Show fewer" : `Show all ${fmt(relics.length)}`}
        </Button>
      )}
    </div>
  );
}

/**
 * Under the item window's title for a set or one of its parts: the set and
 * each part, with how many you own, to switch between them.
 */
export function SetPartStrip({ target }: { target: ItemInfoTarget }) {
  const { sets, ctx, relics } = useSetData();
  const set = target.set ? sets.find((s) => s.name === target.set) : sets.find((s) => s.parts.some((p) => p.unique_name === target.uniqueName));
  if (!set) return null;
  const chip = (current: boolean) =>
    cn(
      "inline-flex h-control-sm items-center gap-1.5 rounded-md border px-2.5 text-xs",
      current ? "border-accent bg-selected text-text" : "border-border text-muted hover:bg-hover hover:text-text",
    );
  return (
    <div role="group" aria-label={`${set.name} and its parts`} className="flex flex-wrap gap-1">
      <button
        type="button"
        aria-pressed={target.set !== undefined}
        className={chip(target.set !== undefined)}
        onClick={() => {
          openSetInfo(set);
        }}
      >
        Set
      </button>
      {setParts(set, ctx).map((part) => {
        const current = part.item.unique_name === target.uniqueName && target.set === undefined;
        return (
          <button
            key={part.item.unique_name}
            type="button"
            aria-pressed={current}
            className={chip(current)}
            onClick={() => {
              openPartInfo(set, part);
            }}
          >
            {part.label}
            {part.qty === 0 ? (
              <MissingPart id={part.item.unique_name} own={ctx.own} relics={relics} />
            ) : (
              <Badge tone={part.qty > part.required ? "warning" : "success"}>
                {part.qty}
                <span className="sr-only"> owned</span>
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A part's ducats against its price, and which is the better deal by your sell-from prices. */
function PartTrade({ uniqueName }: { uniqueName: string }) {
  const { sets, ctx } = useSetData();
  const set = sets.find((s) => s.parts.some((p) => p.unique_name === uniqueName));
  const part = set ? setParts(set, ctx).find((p) => p.item.unique_name === uniqueName) : undefined;
  if (!part) return <p className="text-sm text-muted">Not part of a prime set.</p>;
  const ducats = part.item.ducats ?? null;
  const advice =
    part.better === "plat"
      ? `Better sold: it fetches at least ${fmt(part.sellFrom ?? 0)}p.`
      : part.better === "ducats"
        ? `Better for ducats at Baro Ki'Teer: it fetches less than ${fmt(part.sellFrom ?? 0)}p.`
        : "No market price yet to compare.";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">Ducats</dt>
        <dd className="tabular-nums">{ducats === null ? "—" : fmt(ducats)}</dd>
        <dt className="text-muted">Price</dt>
        <dd className="tabular-nums">{part.price === null ? "—" : `${fmt(part.price)}p`}</dd>
        <dt className="text-muted">Owned</dt>
        <dd className="tabular-nums">
          {fmt(part.qty)}
          {part.required > 1 && ` (the set needs ${fmt(part.required)})`}
        </dd>
      </dl>
      <p
        className={part.better ? "text-tone" : "text-muted"}
        style={part.better ? domainTone(part.better === "plat" ? "price-platinum" : "ducat") : undefined}
      >
        {advice}
      </p>
    </div>
  );
}

const isSet = ({ target }: { target: ItemInfoTarget }) => target.set !== undefined;

/** Item window sections for prime sets, added by the app shell. */
export const SET_INFO_SECTIONS: readonly InfoSection[] = [
  {
    id: "part-trade",
    title: "Sell or trade for ducats",
    tab: "info",
    // Prime parts drop from relics; the section finds the part's set itself.
    appliesTo: ({ target, relics }) => target.set === undefined && relics.length > 0,
    render: ({ target }) => <PartTrade uniqueName={target.uniqueName} />,
  },
  {
    id: "set-selling",
    title: "Selling",
    tab: "info",
    appliesTo: isSet,
    render: ({ target }) => (target.set ? <SetSelling name={target.set} /> : null),
  },
  {
    id: "set-relics",
    title: "Relics",
    tab: "relics",
    appliesTo: isSet,
    render: ({ target }) => (target.set ? <SetRelics name={target.set} /> : null),
  },
];
