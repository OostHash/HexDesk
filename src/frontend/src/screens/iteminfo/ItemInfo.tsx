import { useMemo, useState } from "react";
import { useModCounts, useOwnership } from "../../api/inventory";
import { useItemDetails } from "../../api/items";
import { useCatalogIndex, useDropData } from "../../api/relics";
import { startRank, type ItemDetails } from "../../domain/items";
import { modQty } from "../../domain/market";
import { relicSources } from "../../domain/relics";
import { wikiUrl } from "../../domain/wiki";
import { Skeleton } from "../../primitives/display";
import { FormField, Slider } from "../../primitives/forms";
import type { InfoSection, ItemInfoTarget, SectionContext } from "../../state/itemInfo";
import { SECTIONS } from "./sections";

/** "Rare · Primary mod", "Legendary · Warframe arcane", or the category. */
function kindLine(target: ItemInfoTarget, details: ItemDetails | null): string {
  if (!details) return target.category;
  const type = details.type_name ? details.type_name.charAt(0) + details.type_name.slice(1).toLowerCase() : target.category;
  return [details.rarity, type].filter(Boolean).join(" · ");
}

type InfoTab = InfoSection["tab"];

/** What the item window shows of a catalogue item, split by tab. */
export type ItemInfoData = {
  /** True while the item's details load; the tabs are not known yet. */
  pending: boolean;
  ctx: SectionContext;
  maxRank: number;
  /** True once a rank was picked on the Info tab. */
  rankPicked: boolean;
  /** "Rare · Primary mod", or the category. */
  kind: string;
  /** Copies owned; null for a set, whose ownership is per part. */
  owned: number | null;
  /** False when the item cannot be traded on warframe.market. */
  tradable: boolean;
  wikiUrl: string;
  byTab: Readonly<Record<InfoTab, readonly InfoSection[]>>;
};

/**
 * Details, relics and sections of one catalogue item. Call it in a component
 * keyed by the item, so the rank starts over for each item.
 */
export function useItemInfo(target: ItemInfoTarget, extraSections: readonly InfoSection[]): ItemInfoData {
  // Sets have no backend details; their tabs are built from the catalogue.
  const detailsQuery = useItemDetails(target.set ? null : target.uniqueName);
  const details = target.set ? null : (detailsQuery.data ?? null);
  const mods = useModCounts();
  const { ownership } = useOwnership();
  const copies = mods[target.uniqueName]?.by_rank;
  const maxRank = details?.max_rank ?? 0;
  // Until you pick a rank it follows your highest copy, which needs the details to have loaded.
  const [picked, setRank] = useState<number | null>(null);
  const rank = picked ?? startRank(copies, maxRank);
  const drops = useDropData();
  const { index } = useCatalogIndex();
  const relics = useMemo(
    () => (target.set ? [] : relicSources(target.name, drops.data ?? [], index, ownership)),
    [target.set, target.name, drops.data, index, ownership],
  );
  const ctx: SectionContext = { target, details, rank, setRank, copies, relics };
  const applying = [...SECTIONS, ...extraSections].filter((s) => s.appliesTo(ctx));
  return {
    pending: !target.set && detailsQuery.isPending,
    ctx,
    maxRank,
    rankPicked: picked !== null,
    kind: kindLine(target, details),
    owned: target.set ? null : modQty(ownership, mods, target.uniqueName),
    tradable: details ? details.tradable : true,
    wikiUrl: details?.wiki_url ?? wikiUrl(target.set ?? target.name),
    byTab: {
      info: applying.filter((s) => s.tab === "info"),
      relics: applying.filter((s) => s.tab === "relics"),
      drops: applying.filter((s) => s.tab === "drops"),
    },
  };
}

/** The sections of one tab; the Info tab of a ranked item starts with the rank slider. */
export function ItemInfoTab({ data, tab }: { data: ItemInfoData; tab: InfoTab }) {
  if (data.pending) return <Skeleton lines={5} />;
  const { ctx, maxRank } = data;
  return (
    <div className="flex flex-col gap-4">
      {tab === "info" && maxRank > 0 && (
        <FormField label="Rank">
          <Slider value={ctx.rank} onValueChange={ctx.setRank} min={0} max={maxRank} formatValue={(r) => `${String(r)} of ${String(maxRank)}`} />
        </FormField>
      )}
      {data.byTab[tab].map((section) => (
        <section key={section.id} aria-labelledby={`item-info-${section.id}`} className="flex flex-col gap-1.5">
          <h3 id={`item-info-${section.id}`} className="text-sm font-semibold">
            {section.title}
          </h3>
          {section.render(ctx)}
        </section>
      ))}
    </div>
  );
}
