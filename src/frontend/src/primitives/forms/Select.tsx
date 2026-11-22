import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { fieldVariants, type FieldSize } from "./fieldStyles";
import { useFieldControl } from "./FormField";

type Props = Omit<ComponentProps<"select">, "size"> & {
  size?: FieldSize;
  invalid?: boolean;
};

/** Native <select> with a decorative chevron. */
export function Select({ size, invalid, id, required, className, children, ...rest }: Props) {
  const field = useFieldControl({ id, invalid, required });
  return (
    <div className={cn("relative flex items-center", className)}>
      <select className={cn(fieldVariants({ size }), "appearance-none border-border pe-8")} {...field} {...rest}>
        {children}
      </select>
      <Icon icon={ChevronDown} size="sm" className="pointer-events-none absolute end-2.5 text-muted" />
    </div>
  );
}
