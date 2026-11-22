import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../cn";

const cardVariants = cva("flex min-w-0 flex-col rounded-lg border border-border bg-surface text-text", {
  variants: {
    padding: { none: "", sm: "gap-2 p-3", md: "gap-3 p-4", lg: "gap-4 p-6" },
    elevation: { 0: "", 1: "shadow-1", 2: "shadow-2" },
    interactive: {
      true: "transition-colors motion-reduce:transition-none hover:border-border-strong hover:bg-hover",
      false: "",
    },
  },
  defaultVariants: { padding: "md", elevation: 0, interactive: false },
});

type Props = {
  as?: "div" | "section" | "article" | "li";
  padding?: "none" | "sm" | "md" | "lg";
  elevation?: 0 | 1 | 2;
  /** Hover feedback for cards that contain one main action. The card itself is not clickable. */
  interactive?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/** Panel/card surface. There is no separate Panel: use Card. */
export function Card({ as: Element = "div", padding, elevation, interactive, header, footer, className, children }: Props) {
  return (
    <Element className={cn(cardVariants({ padding, elevation, interactive }), className)}>
      {header && <div className="flex items-center justify-between gap-2">{header}</div>}
      {children}
      {footer && <div className="flex items-center justify-end gap-2">{footer}</div>}
    </Element>
  );
}
