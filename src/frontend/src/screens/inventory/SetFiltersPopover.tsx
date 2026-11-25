import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { activeSetFilterCount, DEFAULT_SET_FILTERS, toggleIn, type SetFilters } from "../../domain/market";
import { Button } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Chip } from "../../primitives/display";
import { Popover } from "../../primitives/overlay";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

/** Progress, built-item and vault filters of Prime Sets. */
export function SetFiltersPopover({ filters, onChange }: { filters: SetFilters; onChange: (patch: Partial<SetFilters>) => void }) {
  const active = activeSetFilterCount(filters);
  return (
    <Popover
      label="Filters"
      placement="bottom"
      className="w-72"
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
        <Group label="Parts">
          <Chip
            active={filters.missingOne}
            onActiveChange={(missingOne) => {
              onChange({ missingOne });
            }}
          >
            Missing one part
          </Chip>
        </Group>
        <Group label="Built item">
          <Chip
            active={filters.built.includes("owned")}
            onActiveChange={() => {
              onChange({ built: toggleIn(filters.built, "owned") });
            }}
          >
            Owned
          </Chip>
          <Chip
            active={filters.built.includes("notowned")}
            onActiveChange={() => {
              onChange({ built: toggleIn(filters.built, "notowned") });
            }}
          >
            Not owned
          </Chip>
        </Group>
        <Group label="Vault">
          <Chip
            active={filters.vault.includes("vaulted")}
            onActiveChange={() => {
              onChange({ vault: toggleIn(filters.vault, "vaulted") });
            }}
          >
            Vaulted
          </Chip>
          <Chip
            active={filters.vault.includes("unvaulted")}
            onActiveChange={() => {
              onChange({ vault: toggleIn(filters.vault, "unvaulted") });
            }}
          >
            Unvaulted
          </Chip>
        </Group>
        {active > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              onChange({ missingOne: DEFAULT_SET_FILTERS.missingOne, built: DEFAULT_SET_FILTERS.built, vault: DEFAULT_SET_FILTERS.vault });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </Popover>
  );
}
