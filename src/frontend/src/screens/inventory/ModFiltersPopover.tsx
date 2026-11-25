import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { toggleRank, type ModRankFilter } from "../../domain/inventory";
import { activeModFilterCount, DEFAULT_MOD_FILTERS, type ModFilters, type ModTrait } from "../../domain/market";
import { Button } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Chip } from "../../primitives/display";
import { Popover } from "../../primitives/overlay";

const RARITIES = ["Common", "Uncommon", "Rare", "Legendary"] as const;
/** WFCD's polarity names, in the order the game's mod screen lists them. */
const POLARITIES = ["madurai", "vazarin", "naramon", "zenurik", "unairu", "penjaga", "umbra", "aura", "universal"] as const;
const TRAITS: ReadonlyArray<{ id: ModTrait; label: string }> = [
  { id: "augment", label: "Augment" },
  { id: "exilus", label: "Exilus" },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const toggle = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

/** Rarity, polarity, augment/exilus and owned-rank filters of Mods & Arcanes. */
export function ModFiltersPopover({
  filters,
  ranks,
  onChange,
}: {
  filters: ModFilters;
  /** Ranks above 0 that any owned mod has. */
  ranks: readonly number[];
  onChange: (patch: Partial<ModFilters>) => void;
}) {
  const active = activeModFilterCount(filters);
  return (
    <Popover
      label="Filters"
      placement="bottom"
      className="w-80"
      trigger={(props) => (
        <button
          type="button"
          className={cn(
            "inline-flex h-control-sm items-center gap-1 rounded-md border px-2.5 text-xs hover:bg-hover hover:text-text",
            active === 0 ? "border-border text-muted" : "border-accent text-text",
          )}
          {...props}
        >
          <SlidersHorizontal aria-hidden="true" className="size-3" />
          Filters{active > 0 ? ` (${String(active)})` : ""}
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <Group label="Rarity">
          {RARITIES.map((r) => (
            <Chip
              key={r}
              active={filters.rarity.includes(r)}
              onActiveChange={() => {
                onChange({ rarity: toggle(filters.rarity, r) });
              }}
            >
              {r}
            </Chip>
          ))}
        </Group>
        <Group label="Polarity">
          {POLARITIES.map((p) => (
            <Chip
              key={p}
              active={filters.polarity.includes(p)}
              onActiveChange={() => {
                onChange({ polarity: toggle(filters.polarity, p) });
              }}
            >
              {capitalize(p)}
            </Chip>
          ))}
        </Group>
        <Group label="Type">
          {TRAITS.map((t) => (
            <Chip
              key={t.id}
              active={filters.traits.includes(t.id)}
              onActiveChange={() => {
                onChange({ traits: toggle(filters.traits, t.id) });
              }}
            >
              {t.label}
            </Chip>
          ))}
        </Group>
        {ranks.length > 0 && (
          <Group label="Owned rank">
            {(["unranked", ...ranks] as ModRankFilter[]).map((r) => (
              <Chip
                key={r}
                active={filters.ranks.includes(r)}
                onActiveChange={() => {
                  onChange({ ranks: toggleRank(filters.ranks, r) });
                }}
              >
                {r === "unranked" ? "Unranked" : `Rank ${String(r)}`}
              </Chip>
            ))}
          </Group>
        )}
        {active > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              onChange({
                rarity: DEFAULT_MOD_FILTERS.rarity,
                polarity: DEFAULT_MOD_FILTERS.polarity,
                traits: DEFAULT_MOD_FILTERS.traits,
                ranks: DEFAULT_MOD_FILTERS.ranks,
              });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </Popover>
  );
}
