import { Star, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { imageSources } from "../../api/catalog";
import { formatAge } from "../../domain/inventory";
import type { CardRow } from "../../domain/items";
import { ItemImage } from "../../patterns/ItemImage";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, Card, domainTone } from "../../primitives/display";

export type RecentChange = { delta: number; minutesAgo: number } | null;

const fmt = (n: number) => n.toLocaleString("en-US");

type DomainColor = Parameters<typeof domainTone>[0];

const RARITY_COLOR: Readonly<Record<string, DomainColor>> = {
  Common: "rarity-bronze",
  Uncommon: "rarity-silver",
  Rare: "rarity-gold",
  Legendary: "rarity-legendary",
};

/** Domain colour of a mod or arcane rarity; null for an unknown rarity. */
export const rarityColor = (rarity: string | null | undefined): DomainColor | null => (rarity ? (RARITY_COLOR[rarity] ?? null) : null);

export function MasteryBadge({ rank }: { rank: number }) {
  if (rank >= 30) {
    return (
      <Badge tone="domain" style={domainTone("mastery")} icon={Star}>
        Mastered
      </Badge>
    );
  }
  return rank > 0 ? <Badge>Rank {rank}</Badge> : null;
}

export function PriceBadges({ plat, ducats }: { plat: number | null; ducats: number | null }) {
  return (
    <>
      {ducats !== null && ducats > 0 && (
        <Badge tone="domain" style={domainTone("ducat")} title={`${fmt(ducats)} ducats`}>
          {fmt(ducats)} ducats
        </Badge>
      )}
      {plat !== null && (
        <Badge tone="domain" style={domainTone("price-platinum")} title={`Market: ${fmt(plat)} platinum`}>
          {fmt(plat)}p
        </Badge>
      )}
    </>
  );
}

export function ChangeBadge({ recent }: { recent: RecentChange }) {
  if (!recent) return null;
  const up = recent.delta > 0;
  return (
    <Badge tone={up ? "success" : "danger"} icon={up ? TrendingUp : TrendingDown}>
      {up ? "+" : "−"}
      {fmt(Math.abs(recent.delta))} · {formatAge(recent.minutesAgo)}
    </Badge>
  );
}

export function FavoriteButton({ name, favorite, onToggle }: { name: string; favorite: boolean; onToggle: () => void }) {
  return (
    <IconButton
      icon={Star}
      size="sm"
      pressed={favorite}
      label={favorite ? `Remove ${name} from the modular window` : `Add ${name} to the modular window`}
      className={cn(favorite && "text-warning [&_svg]:fill-current")}
      onClick={onToggle}
    />
  );
}

export type ItemCardProps = {
  name: string;
  imageName: string | null | undefined;
  baseUrl: string | undefined;
  /** The line under the name: compatibility and polarity, arcane type or category. */
  subline: string;
  /** Why the item matched a search, when the name does not say. */
  note?: string | null | undefined;
  /** Mod or arcane rarity, shown as a coloured dot before the subline. */
  rarity?: string | null | undefined;
  /** The big number: owned count, or owned parts of a set ("2/3"). */
  count: string;
  /** Spoken in place of `count`, e.g. "58 owned". */
  countLabel: string;
  /** Not owned: dashed outline and a muted count. */
  missing: boolean;
  plat: number | null;
  ducats: number | null;
  /** Makes the platinum price a button that opens the market window. */
  onOpenMarket?: (() => void) | undefined;
  /** What a click on the card opens: the item info window. */
  onOpen?: (() => void) | undefined;
  favorite: boolean;
  onToggleFavorite: () => void;
  /** Badges under the count: recent change, building. */
  badges?: ReactNode | undefined;
  recent?: RecentChange | undefined;
  /** The small table at the bottom of the card. */
  rows: readonly CardRow[];
};

/**
 * One item as a card, the same for every kind of item. Three things react to
 * a click: the star (favourite), the price (market window) and the rest of
 * the card (item info window).
 */
export function ItemCard(props: ItemCardProps) {
  const { name, count, missing, plat, ducats, onOpenMarket, onOpen, rows, recent } = props;
  const dot = rarityColor(props.rarity);
  return (
    <li>
      <Card
        as="article"
        padding="sm"
        interactive={onOpen !== undefined}
        className={cn(
          "relative flex h-full flex-col items-center gap-1 text-center",
          missing && "border-dashed bg-transparent",
          recent && (recent.delta > 0 ? "border-s-2 border-s-success" : "border-s-2 border-s-danger"),
        )}
      >
        <header className="flex w-full items-start gap-1">
          <span className="relative z-10">
            <FavoriteButton name={name} favorite={props.favorite} onToggle={props.onToggleFavorite} />
          </span>
          <span className="relative z-10 ms-auto flex flex-wrap justify-end gap-1">
            {ducats !== null && ducats > 0 && (
              <Badge tone="domain" style={domainTone("ducat")} title={`${fmt(ducats)} ducats`}>
                {fmt(ducats)} ducats
              </Badge>
            )}
            {plat !== null &&
              (onOpenMarket ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={onOpenMarket}
                  className="rounded-sm transition-opacity hover:opacity-80"
                  aria-label={`${name}: ${fmt(plat)} platinum, open the market`}
                >
                  <Badge tone="domain" style={domainTone("price-platinum")}>
                    {fmt(plat)}p
                  </Badge>
                </button>
              ) : (
                <Badge tone="domain" style={domainTone("price-platinum")} title={`Market: ${fmt(plat)} platinum`}>
                  {fmt(plat)}p
                </Badge>
              ))}
          </span>
        </header>
        <ItemImage sources={imageSources(props.imageName ?? undefined, props.baseUrl)} name={name} />
        <h3 className="text-sm">
          {onOpen ? (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={onOpen}
              className="line-clamp-2 rounded-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:text-accent"
            >
              {name}
            </button>
          ) : (
            <span className="line-clamp-2 font-semibold">{name}</span>
          )}
        </h3>
        <p className="flex items-center gap-1 text-xs text-muted">
          {dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--hex-tone)]" style={domainTone(dot)} />}
          {props.rarity && <span className="sr-only">{props.rarity}, </span>}
          <span className="line-clamp-1">{props.subline}</span>
        </p>
        {props.note && <p className="line-clamp-2 text-xs text-accent">{props.note}</p>}
        <p className={cn("text-lg font-semibold tabular-nums", missing && "text-muted")} aria-label={props.countLabel}>
          {count}
        </p>
        {props.badges && <span className="flex flex-wrap justify-center gap-1">{props.badges}</span>}
        {rows.length > 0 && (
          <dl
            aria-label={`${name} details`}
            className="mt-auto grid w-full grid-cols-[1fr_auto] gap-x-3 border-t border-border pt-1 text-start text-xs"
          >
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className={cn("text-muted", row.muted && "italic")}>{row.label}</dt>
                <dd className="text-end tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </li>
  );
}
