import { LayoutGrid, List, Settings2 } from "lucide-react";
import { useState } from "react";
import { Switch } from "../primitives/forms";
import { Popover } from "../primitives/overlay";
import { cn } from "../primitives/cn";
import { CardScaleStepper } from "./CardScale";
import { PageSizeSelect, type PageSizeScreen } from "./PageSize";

export type View = "cards" | "list";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the choice still holds for this session.
  }
};

/** Whether a screen shows item images (cards and list), remembered per screen. */
export function useShowImages(screen: PageSizeScreen) {
  const key = `ff-images-${screen}`;
  const [show, setShow] = useState(() => read(key) !== "off");
  const set = (next: boolean) => {
    setShow(next);
    write(key, next ? "on" : "off");
  };
  return [show, set] as const;
}

/** Whether a screen shows the recipe (parts list) on its items, remembered per screen. */
export function useShowRecipes(screen: PageSizeScreen) {
  const key = `ff-recipes-${screen}`;
  const [show, setShow] = useState(() => read(key) !== "off");
  const set = (next: boolean) => {
    setShow(next);
    write(key, next ? "on" : "off");
  };
  return [show, set] as const;
}

type Props = {
  screen: PageSizeScreen;
  /** Cards/List switch; leave out on screens that only have cards. */
  view?: View;
  onViewChange?: (view: View) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  images: boolean;
  onImagesChange: (show: boolean) => void;
  /** Recipes switch; leave out on screens without recipes. */
  recipes?: boolean;
  onRecipesChange?: (show: boolean) => void;
};

const segment =
  "inline-flex h-control-sm w-8 cursor-pointer items-center justify-center rounded-md border border-border text-muted hover:bg-hover hover:text-text";

/**
 * End of a screen's toolbar: Cards/List as icons and a settings popover with
 * card size, items per page and images. Every list screen uses it, so the
 * controls look and sit the same everywhere.
 */
export function ViewControls({
  screen,
  view,
  onViewChange,
  scale,
  onScaleChange,
  pageSize,
  onPageSizeChange,
  images,
  onImagesChange,
  recipes,
  onRecipesChange,
}: Props) {
  const showScale = view !== "list";
  return (
    <div className="ms-auto flex items-center gap-1">
      {view && onViewChange && (
        <fieldset className="flex gap-1">
          <legend className="sr-only">View</legend>
          {(
            [
              ["cards", "Cards", LayoutGrid],
              ["list", "List", List],
            ] as const
          ).map(([value, label, Icon]) => (
            <label
              key={value}
              title={label}
              className={cn(
                segment,
                "has-checked:border-accent has-checked:bg-selected has-checked:text-text has-focus-visible:outline-2 has-focus-visible:outline-focus",
              )}
            >
              <input
                type="radio"
                name={`ff-view-${screen}`}
                value={value}
                checked={view === value}
                onChange={() => {
                  onViewChange(value);
                }}
                className="sr-only"
              />
              <Icon aria-hidden="true" className="size-4" />
              <span className="sr-only">{label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Popover
        label="View settings"
        // Right edge on the gear: the panel opens into the screen, not over the side dock.
        placement="bottom-end"
        className="w-64"
        trigger={(props) => (
          <button type="button" aria-label="View settings" title="View settings" className={segment} {...props}>
            <Settings2 aria-hidden="true" className="size-4" />
          </button>
        )}
      >
        <div className="flex flex-col gap-3">
          {showScale && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span aria-hidden="true">Card size</span>
              <CardScaleStepper value={scale} onChange={onScaleChange} />
            </div>
          )}
          <PageSizeSelect screen={screen} value={pageSize} onChange={onPageSizeChange} className="justify-between" />
          <Switch checked={images} onCheckedChange={onImagesChange} className="justify-between text-xs text-muted">
            <span className="order-first">Images</span>
          </Switch>
          {recipes !== undefined && onRecipesChange && (
            <Switch checked={recipes} onCheckedChange={onRecipesChange} className="justify-between text-xs text-muted">
              <span className="order-first">Recipes</span>
            </Switch>
          )}
        </div>
      </Popover>
    </div>
  );
}
