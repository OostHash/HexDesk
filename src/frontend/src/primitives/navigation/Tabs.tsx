import { createContext, useContext, type ReactNode } from "react";
import { Tab as AriaTab, TabList as AriaTabList, TabPanel as AriaTabPanel, Tabs as AriaTabs, type Key } from "react-aria-components";
import { cn } from "../cn";

/**
 * Tabs on React Aria: role="tablist", roving tabindex, arrow
 * keys, Home/End, aria-selected and panel wiring. Compose Tabs > TabList >
 * Tab and TabPanel with matching ids.
 */
type TabsProps<K extends string> = {
  selectedKey: K;
  onSelectionChange: (key: K) => void;
  /** "automatic": arrow keys select. "manual": arrow keys move focus, Enter selects. */
  keyboardActivation?: "automatic" | "manual";
  className?: string;
  children: ReactNode;
};

export function Tabs<K extends string>({ selectedKey, onSelectionChange, keyboardActivation = "automatic", className, children }: TabsProps<K>) {
  return (
    <AriaTabs
      selectedKey={selectedKey}
      onSelectionChange={(key: Key) => {
        onSelectionChange(String(key) as K);
      }}
      keyboardActivation={keyboardActivation}
      className={cn("flex flex-col gap-3", className)}
    >
      {children}
    </AriaTabs>
  );
}

type TabListProps = {
  /** Accessible name of the tab list. */
  label: string;
  /** "underline": page-level tabs. "pills": compact segment, e.g. a section header. */
  appearance?: "underline" | "pills";
  className?: string;
  children: ReactNode;
};

const APPEARANCE = {
  underline: {
    list: "flex gap-1 border-b border-border",
    tab:
      "-mb-px flex h-control-md cursor-default items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted outline-none " +
      "data-hovered:text-text data-selected:border-accent data-selected:text-text " +
      "data-focus-visible:outline-2 data-focus-visible:outline-focus data-disabled:opacity-50",
  },
  pills: {
    list: "flex gap-1",
    tab:
      "flex h-control-sm cursor-default items-center gap-1 rounded-md border border-border px-2 text-xs text-muted outline-none " +
      "data-hovered:bg-hover data-hovered:text-text data-selected:border-accent data-selected:bg-selected data-selected:text-text " +
      "data-focus-visible:outline-2 data-focus-visible:outline-focus data-disabled:opacity-50",
  },
} as const;

const AppearanceContext = createContext<keyof typeof APPEARANCE>("underline");

export function TabList({ label, appearance = "underline", className, children }: TabListProps) {
  return (
    <AppearanceContext value={appearance}>
      <AriaTabList aria-label={label} className={cn(APPEARANCE[appearance].list, className)}>
        {children}
      </AriaTabList>
    </AppearanceContext>
  );
}

type TabProps = {
  id: string;
  disabled?: boolean;
  /** Overrides the appearance taken from the surrounding TabList. */
  appearance?: keyof typeof APPEARANCE;
  children: ReactNode;
};

export function Tab({ id, disabled = false, appearance, children }: TabProps) {
  const inherited = useContext(AppearanceContext);
  return (
    <AriaTab id={id} isDisabled={disabled} className={APPEARANCE[appearance ?? inherited].tab}>
      {children}
    </AriaTab>
  );
}

type TabPanelProps = { id: string; className?: string; children: ReactNode };

export function TabPanel({ id, className, children }: TabPanelProps) {
  return (
    <AriaTabPanel id={id} className={cn("outline-none data-focus-visible:outline-2 data-focus-visible:outline-focus", className)}>
      {children}
    </AriaTabPanel>
  );
}
