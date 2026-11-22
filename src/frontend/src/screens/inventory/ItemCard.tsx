import { Hammer, Star, TrendingDown, TrendingUp } from "lucide-react";
import { imageSources } from "../../api/catalog";
import { openExternal } from "../../api/links";
import { formatAge, type InventoryRow, type ModCounts } from "../../domain/inventory";
import { wikiUrl } from "../../domain/wiki";
import { ItemImage } from "../../patterns/ItemImage";
import { WikiMenu } from "../../patterns/WikiMenu";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, Card, domainTone } from "../../primitives/display";

export type ItemExtras = {
  favorite: boolean;
  onToggleFavorite: () => void;
  building: string | null;
  recent: { delta: number; minutesAgo: number } | null;
  baseUrl: string | undefined;
  mods: ModCounts;
};

const fmt = (n: number) => n.toLocaleString("en-US");

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
      {plat !== null && (
        <Badge tone="domain" style={domainTone("price-platinum")} title={`Market: ${fmt(plat)} platinum`}>
          {fmt(plat)}p
        </Badge>
      )}
      {ducats !== null && ducats > 0 && (
        <Badge tone="domain" style={domainTone("ducat")} title={`${fmt(ducats)} ducats`}>
          {fmt(ducats)} ducats
        </Badge>
      )}
    </>
  );
}

export function ChangeBadge({ recent }: { recent: ItemExtras["recent"] }) {
  if (!recent) return null;
  const up = recent.delta > 0;
  return (
    <Badge tone={up ? "success" : "danger"} icon={up ? TrendingUp : TrendingDown}>
      {up ? "+" : "−"}
      {fmt(Math.abs(recent.delta))} · {formatAge(recent.minutesAgo)}
    </Badge>
  );
}

export function ItemMenu({ name }: { name: string }) {
  return <WikiMenu name={name} url={wikiUrl(name)} onOpen={(url) => void openExternal(url)} />;
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

/** One inventory item as a card. Mods and arcanes show copies per rank. */
export function ItemCard({ row, extras }: { row: InventoryRow; extras: ItemExtras }) {
  const { item, qty, plat, ducats, mastery } = row;
  const ranks = extras.mods[item.unique_name];
  const zero = qty === 0 && !extras.building;
  return (
    <li>
      <Card
        as="article"
        padding="md"
        className={cn(
          "h-full",
          zero && "border-dashed bg-transparent",
          extras.recent && (extras.recent.delta > 0 ? "border-s-2 border-s-success" : "border-s-2 border-s-danger"),
        )}
      >
        <header className="flex items-start gap-1">
          <FavoriteButton name={item.name} favorite={extras.favorite} onToggle={extras.onToggleFavorite} />
          <span className="ms-auto flex flex-wrap justify-end gap-1">
            <PriceBadges plat={plat} ducats={ducats} />
          </span>
          <ItemMenu name={item.name} />
        </header>
        <div className="flex flex-col items-center gap-1 text-center">
          <ItemImage sources={imageSources(item.image_name ?? undefined, extras.baseUrl)} name={item.name} />
          <h3 className="line-clamp-2 text-sm font-semibold">{item.name}</h3>
          <p className="text-xs text-muted">{item.category}</p>
          <p className={cn("text-lg font-semibold tabular-nums", zero && "text-muted")} aria-label={`${fmt(qty)} owned`}>
            {fmt(qty)}
          </p>
          <span className="flex flex-wrap justify-center gap-1">
            <MasteryBadge rank={mastery} />
            {extras.building && (
              <Badge tone="info" icon={Hammer}>
                Building
              </Badge>
            )}
            <ChangeBadge recent={extras.recent} />
          </span>
        </div>
        {ranks && (
          <dl aria-label={`${item.name} by rank`} className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-border pt-1 text-xs">
            {Object.entries(ranks.by_rank)
              .filter(([, count]) => count > 0)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([rank, count]) => (
                <div key={rank} className="contents">
                  <dt className="text-muted">{rank === "0" ? "Unranked" : `Rank ${rank}`}</dt>
                  <dd className="text-end tabular-nums">{count}</dd>
                </div>
              ))}
          </dl>
        )}
      </Card>
    </li>
  );
}
