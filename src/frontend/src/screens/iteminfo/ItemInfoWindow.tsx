import { BookOpen, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { imageSources, useImageBaseUrl } from "../../api/catalog";
import { useModCounts, useOwnership } from "../../api/inventory";
import { useItemDetails } from "../../api/items";
import { openExternal } from "../../api/links";
import { prioritisePrice, useWfmLookup } from "../../api/market";
import { useCatalogIndex, useDropData } from "../../api/relics";
import { startRank, type ItemDetails } from "../../domain/items";
import { modQty, normalizeForWfm } from "../../domain/market";
import { relicSources } from "../../domain/relics";
import { wikiUrl } from "../../domain/wiki";
import { ItemImage } from "../../patterns/ItemImage";
import { Button } from "../../primitives/actions";
import { Skeleton } from "../../primitives/display";
import { FormField, Slider } from "../../primitives/forms";
import { Modal } from "../../primitives/overlay";
import { closeItemInfo, useItemInfoTarget, type InfoSection, type ItemInfoTarget, type SectionContext } from "../../state/itemInfo";
import { openItemWindow } from "../../state/itemWindow";
import { SECTIONS } from "./sections";

const fmt = (n: number) => n.toLocaleString("en-US");

/** "Rare · Primary mod", "Legendary · Warframe arcane", or the category. */
function kindLine(target: ItemInfoTarget, details: ItemDetails | null): string {
  if (!details) return target.category;
  const type = details.type_name ? details.type_name.charAt(0) + details.type_name.slice(1).toLowerCase() : target.category;
  return [details.rarity, type].filter(Boolean).join(" · ");
}

function InfoBody({ target, details, sections: all }: { target: ItemInfoTarget; details: ItemDetails | null; sections: readonly InfoSection[] }) {
  const mods = useModCounts();
  const { ownership } = useOwnership();
  const lookup = useWfmLookup();
  const copies = mods[target.uniqueName]?.by_rank;
  const maxRank = details?.max_rank ?? 0;
  const [rank, setRank] = useState(() => startRank(copies, maxRank));
  const owned = modQty(ownership, mods, target.uniqueName);
  const slug = lookup.get(normalizeForWfm(target.name));
  const tradable = details ? details.tradable : true;
  const drops = useDropData();
  const { index } = useCatalogIndex();
  const relics = useMemo(
    () => (target.set ? [] : relicSources(target.name, drops.data ?? [], index, ownership)),
    [target.set, target.name, drops.data, index, ownership],
  );
  const ctx: SectionContext = { target, details, rank, setRank, copies, relics };
  const sections = all.filter((s) => s.appliesTo(ctx));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-muted">{kindLine(target, details)}</span>
        {/* A set's ownership is per part, in the Parts section. */}
        {!target.set && <span className="tabular-nums">{owned > 0 ? `${fmt(owned)} owned` : "Not owned"}</span>}
        <span className="ms-auto flex gap-2">
          {slug && tradable && (
            <Button
              size="sm"
              leadingIcon={ShoppingCart}
              aria-haspopup="dialog"
              onClick={() => {
                prioritisePrice(slug);
                openItemWindow({ slug, name: target.name, imageName: target.imageName, rank: maxRank > 0 ? rank : null });
              }}
            >
              Market
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={BookOpen}
            onClick={() => void openExternal(details?.wiki_url ?? wikiUrl(target.set ?? target.name))}
          >
            Wiki
          </Button>
        </span>
      </div>
      {maxRank > 0 && (
        <FormField label="Rank">
          <Slider value={rank} onValueChange={setRank} min={0} max={maxRank} formatValue={(r) => `${String(r)} of ${String(maxRank)}`} />
        </FormField>
      )}
      {sections.map((section) => (
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

function InfoLoader({ target, sections }: { target: ItemInfoTarget; sections: readonly InfoSection[] }) {
  // Sets have no backend details; their window is built from the catalogue.
  const details = useItemDetails(target.set ? null : target.uniqueName);
  if (target.set) return <InfoBody target={target} details={null} sections={sections} />;
  if (details.isPending) return <Skeleton lines={5} />;
  // Without details (a failed load or an item that has none) the window still
  // offers owned count, market and wiki.
  return <InfoBody target={target} details={details.data ?? null} sections={sections} />;
}

const NO_SECTIONS: readonly InfoSection[] = [];

/** What an item is and does: stats per rank, your copies, where it drops. */
export function ItemInfoWindow({
  target,
  onClose,
  extraSections = NO_SECTIONS,
}: {
  target: ItemInfoTarget | null;
  onClose: () => void;
  /** Sections other screens add, such as a prime set's parts. */
  extraSections?: readonly InfoSection[] | undefined;
}) {
  const sections = useMemo(() => [...SECTIONS, ...extraSections], [extraSections]);
  const baseUrl = useImageBaseUrl();
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      size="lg"
      title={
        target && (
          <span className="flex items-center gap-2">
            <ItemImage size="sm" sources={imageSources(target.imageName ?? undefined, baseUrl)} name={target.name} />
            {target.name}
          </span>
        )
      }
    >
      {target && <InfoLoader key={target.uniqueName} target={target} sections={sections} />}
    </Modal>
  );
}

/** The one item info window of the app, opened with `openItemInfo` (state/itemInfo). */
export function ItemInfoHost({ extraSections }: { extraSections?: readonly InfoSection[] | undefined }) {
  const target = useItemInfoTarget();
  return <ItemInfoWindow target={target} onClose={closeItemInfo} extraSections={extraSections} />;
}
