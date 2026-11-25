import type { Ref } from "react";
import {
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox,
  ListBoxItem,
  Popover as AriaPopover,
  type Key,
} from "react-aria-components";
import { cn } from "../cn";
import { strings } from "../strings";
import { fieldVariants, type FieldSize } from "./fieldStyles";

export type ComboBoxOption = { id: string; label: string };

type Props = {
  label: string;
  hideLabel?: boolean;
  /** Typed text (controlled). */
  inputValue: string;
  onInputChange: (value: string) => void;
  /** Options to show for the current text; filtering is the caller's job. */
  options: readonly ComboBoxOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  size?: FieldSize;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
};

/**
 * Text field with suggestions on React Aria (role="combobox"): arrow keys
 * move through the list, Enter picks, Escape closes. The caller filters the
 * options, so any matching rule (e.g. "contains") works.
 */
export function ComboBox({
  label,
  hideLabel = false,
  inputValue,
  onInputChange,
  options,
  onSelect,
  placeholder,
  size = "md",
  inputRef,
  className,
}: Props) {
  return (
    <AriaComboBox
      inputValue={inputValue}
      onInputChange={onInputChange}
      onChange={(key: Key | null) => {
        if (key !== null) onSelect(String(key));
      }}
      items={options}
      menuTrigger="input"
      // The caller filters, so the list is still empty when the first key is
      // handled; without this the popover would never open.
      allowsEmptyCollection
      className={cn("flex flex-col gap-1", className)}
    >
      <AriaLabel className={cn("text-xs font-medium text-muted", hideLabel && "sr-only")}>{label}</AriaLabel>
      <AriaInput ref={inputRef} {...(placeholder !== undefined ? { placeholder } : {})} className={cn(fieldVariants({ size }), "outline-none")} />
      <AriaPopover
        offset={4}
        className="w-(--trigger-width) rounded-lg border border-border bg-surface-raised p-1 text-sm text-text shadow-2 outline-none"
      >
        <ListBox
          renderEmptyState={() => <p className="px-2 py-1.5 text-xs text-muted">{strings.noResults}</p>}
          className="flex max-h-64 flex-col overflow-y-auto outline-none"
        >
          {(item: ComboBoxOption) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              className="flex h-control-sm items-center rounded-md px-2 outline-none data-focused:bg-hover data-selected:text-accent"
            >
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </AriaPopover>
    </AriaComboBox>
  );
}
