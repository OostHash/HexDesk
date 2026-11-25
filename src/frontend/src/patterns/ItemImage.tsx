import { createContext, useContext, useState } from "react";
import { cn } from "../primitives/cn";

type Props = {
  /** Candidate URLs in order (local cache first, then CDN). Empty: fallback only. */
  sources: readonly string[];
  /** Used for the fallback letter. The image itself is decorative (alt=""). */
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/** False hides item images (the screen's Images setting); the item name stays. */
export const ItemImagesContext = createContext(true);

const SIZE = { sm: "size-6 text-xs", md: "size-8 text-sm", lg: "size-16 text-xl" } as const;

/**
 * Item icon: tries each source in turn and falls back to the item's first
 * letter. Decorative, because the item name is always shown next to it.
 */
export function ItemImage({ sources, name, size = "md", className }: Props) {
  const [index, setIndex] = useState(0);
  const show = useContext(ItemImagesContext);
  if (!show) return null;
  const src = sources[index];
  if (src === undefined) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-hover font-semibold text-muted",
          SIZE[size],
          className,
        )}
      >
        {name.charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        setIndex(index + 1);
      }}
      className={cn("shrink-0 rounded-md object-contain", SIZE[size], className)}
    />
  );
}
