import { CircleCheck, CircleDashed, FileText, Gem, Hammer, Lock, LockOpen, Skull, Sparkles, Star, Swords, Zap } from "lucide-react";
import { imageSources } from "../../api/catalog";
import { openExternal } from "../../api/links";
import type { Ownership } from "../../domain/completionist";
import {
  componentStatus,
  foundryWikiUrl,
  isLichWeapon,
  mergeComponents,
  ownedRelicsFor,
  shardLabel,
  type ArchonShard,
  type ComponentStatus,
  type FoundryItem,
  type RecipeComponent,
} from "../../domain/foundry";
import { ItemImage } from "../../patterns/ItemImage";
import { WikiMenu } from "../../patterns/WikiMenu";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, Card, domainTone, Icon } from "../../primitives/display";

/** Everything one card or row shows, derived once per item by the screen. */
export type CraftInfo = {
  item: FoundryItem;
  /** null while the recipe loads. */
  recipe: RecipeComponent[] | null;
  owned: boolean;
  ready: boolean;
  mastered: boolean;
  rank: number | null;
  building: boolean;
  subsumed: boolean;
  forma: number;
  shards: readonly ArchonShard[];
  tracked: boolean;
};

export type CraftContext = {
  own: Ownership;
  relicDrops: Readonly<Record<string, readonly string[]>>;
  relicNames: ReadonlyMap<string, string>;
  baseUrl: string | undefined;
  onOpen: (item: FoundryItem) => void;
  onToggleTrack: (item: FoundryItem) => void;
  /** Parts list on the card; off hides it (view settings → Recipes). */
  showParts?: boolean;
};

export function TrackButton({ name, tracked, onToggle }: { name: string; tracked: boolean; onToggle: () => void }) {
  return (
    <IconButton
      icon={Star}
      size="sm"
      pressed={tracked}
      label={tracked ? `Stop tracking ${name}` : `Track ${name}`}
      className={cn(tracked && "text-warning [&_svg]:fill-current")}
      onClick={onToggle}
    />
  );
}

export function FoundryWikiMenu({ name }: { name: string }) {
  return <WikiMenu name={name} url={foundryWikiUrl(name)} onOpen={(url) => void openExternal(url)} />;
}

/** Owned / ready / mastery / building: the badges the list view shows too. */
export function StatusBadges({ info }: { info: CraftInfo }) {
  return (
    <>
      {info.owned && (
        <Badge tone="success" icon={CircleCheck}>
          Owned
        </Badge>
      )}
      {info.ready && (
        <Badge tone="accent" icon={Zap}>
          Ready to build
        </Badge>
      )}
      {info.mastered ? (
        <Badge tone="domain" style={domainTone("mastered")} icon={Star}>
          Mastered
        </Badge>
      ) : (
        info.owned && info.rank !== null && info.rank > 0 && <Badge>Rank {info.rank}</Badge>
      )}
      {info.building && (
        <Badge tone="info" icon={Hammer}>
          Building
        </Badge>
      )}
    </>
  );
}

function ExtraBadges({ info }: { info: CraftInfo }) {
  const { item } = info;
  return (
    <>
      {item.mastery_req != null && item.mastery_req > 0 && <Badge variant="outline">MR {item.mastery_req}</Badge>}
      {item.vaulted === true && (
        <Badge tone="domain" style={domainTone("vaulted")} icon={Lock}>
          Vaulted
        </Badge>
      )}
      {item.vaulted === false && (
        <Badge tone="domain" style={domainTone("owned")} icon={LockOpen}>
          Unvaulted
        </Badge>
      )}
      {isLichWeapon(item) && (
        <Badge tone="domain" style={domainTone("kuva")} icon={Swords}>
          Lich / Sister
        </Badge>
      )}
      {info.subsumed && (
        <Badge tone="neutral" icon={Skull}>
          Subsumed
        </Badge>
      )}
      {info.forma > 0 && <Badge icon={Sparkles}>Forma ×{info.forma}</Badge>}
      {info.shards.length > 0 && (
        <Badge tone="domain" style={domainTone("archon")} icon={Gem} title={info.shards.map(shardLabel).join("\n")}>
          Shards {info.shards.length}/5
          <span className="sr-only">: {info.shards.map(shardLabel).join(", ")}</span>
        </Badge>
      )}
    </>
  );
}

const PART_STATUS: Record<ComponentStatus, { icon: typeof CircleCheck; label: string; className: string }> = {
  part: { icon: CircleCheck, label: "Owned", className: "text-success" },
  blueprint: { icon: FileText, label: "Blueprint", className: "text-info" },
  none: { icon: CircleDashed, label: "Missing", className: "text-muted" },
};

function Parts({ info, ctx }: { info: CraftInfo; ctx: CraftContext }) {
  const { item, recipe } = info;
  if (item.source_type) return <p className="text-xs text-muted italic">Acquired in-game</p>;
  if (recipe === null) return <p className="text-xs text-muted">Loading parts…</p>;
  if (recipe.length === 0) return <p className="text-xs text-muted">No recipe</p>;
  return (
    <ul aria-label={`Parts of ${item.name}`} className="flex flex-col divide-y divide-border/60 text-xs">
      {mergeComponents(recipe).map((c) => {
        const status = PART_STATUS[componentStatus(c, ctx.own)];
        const relics = ownedRelicsFor(c.unique_name, ctx.relicDrops, ctx.relicNames, ctx.own);
        return (
          <li key={c.unique_name} className="flex items-center gap-1.5 py-1">
            <Icon icon={status.icon} size="xs" className={status.className} />
            <span className="min-w-0 flex-1 truncate">
              {c.count > 1 && <span className="text-muted tabular-nums">{c.count}× </span>}
              {c.name}
            </span>
            {relics.length > 0 && (
              <Badge size="sm" tone="domain" style={domainTone("relic-highlight")} title={relics.join("\n")}>
                Relic
                <span className="sr-only">: {relics.join(", ")}</span>
              </Badge>
            )}
            <span className={cn("shrink-0", status.className)}>{status.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Opens the recipe; the name is the card's one main action. */
export function RecipeButton({ item, onOpen, className }: { item: FoundryItem; onOpen: (item: FoundryItem) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => {
        onOpen(item);
      }}
      className={cn("truncate rounded-sm text-start font-semibold hover:text-accent hover:underline", className)}
    >
      {item.name}
      <span className="sr-only"> — show recipe</span>
    </button>
  );
}

export function CraftCard({ info, ctx }: { info: CraftInfo; ctx: CraftContext }) {
  const { item } = info;
  return (
    <li>
      <Card
        as="article"
        padding="md"
        interactive
        className={cn("flex h-full flex-col gap-2", info.owned && "border-success/60", info.ready && "border-accent/70")}
      >
        <header className="flex items-start gap-2">
          <ItemImage sources={imageSources(item.image_name ?? undefined, ctx.baseUrl)} name={item.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="flex min-w-0 text-sm">
              <RecipeButton item={item} onOpen={ctx.onOpen} />
            </h3>
            <p className="text-xs text-muted">{item.category}</p>
          </div>
          <TrackButton
            name={item.name}
            tracked={info.tracked}
            onToggle={() => {
              ctx.onToggleTrack(item);
            }}
          />
          <FoundryWikiMenu name={item.name} />
        </header>
        <div className="flex flex-wrap gap-1">
          <StatusBadges info={info} />
          <ExtraBadges info={info} />
        </div>
        {ctx.showParts !== false && (
          <div className="mt-auto border-t border-border pt-1">
            <Parts info={info} ctx={ctx} />
          </div>
        )}
      </Card>
    </li>
  );
}
