import { Search, X } from "lucide-react";
import { useRef, type ComponentProps, type KeyboardEvent } from "react";
import { mergeRefs } from "../../lib/mergeRefs";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { fieldVariants, type FieldSize } from "./fieldStyles";
import { useFieldControl } from "./FormField";
import { strings } from "../strings";

type Props = Omit<ComponentProps<"input">, "size" | "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  size?: FieldSize;
  /** Accessible name when not inside a FormField (there is no visible label). */
  label?: string;
};

/**
 * Search field with icon and clear button. Escape clears the text, or leaves
 * the field when it is already empty.
 */
export function SearchInput({ value, onValueChange, size = "md", label, id, className, onKeyDown, ref, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const field = useFieldControl({ id });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (value) onValueChange("");
    else event.currentTarget.blur();
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <Icon icon={Search} size={size === "sm" ? "xs" : "sm"} className="pointer-events-none absolute start-2.5 text-muted" />
      <input
        ref={mergeRefs(inputRef, ref)}
        type="search"
        aria-label={label}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        className={cn(fieldVariants({ size }), "border-border ps-8 pe-8 [&::-webkit-search-cancel-button]:appearance-none")}
        {...field}
        {...rest}
      />
      {value && (
        <button
          type="button"
          aria-label={strings.clearSearch}
          className="absolute end-1 inline-flex size-6 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-text"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon icon={X} size="xs" />
        </button>
      )}
    </div>
  );
}
