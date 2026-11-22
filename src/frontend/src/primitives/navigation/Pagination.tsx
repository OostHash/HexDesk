import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../actions/Button";
import { cn } from "../cn";
import { strings } from "../strings";

type Props = {
  /** Zero-based page index. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional total, e.g. 128 → "Page 2 of 6 · 128 relics". */
  itemCount?: number;
  /** Plural noun for itemCount, e.g. "relics". */
  itemLabel?: string;
  /**
   * What the list holds, e.g. "800 relics · 32 owned".
   * Shown after the page, and on its own when everything fits on one page.
   */
  summary?: string;
  /** Smaller buttons for toolbars. */
  compact?: boolean;
  className?: string;
};

/**
 * Previous/next paging: hidden for a
 * single page (only the summary stays), disabled buttons at the ends. The
 * status line is aria-live so screen readers hear the new page.
 */
export function Pagination({ page, pageCount, onPageChange, itemCount, itemLabel = "items", summary, compact = false, className }: Props) {
  if (pageCount <= 1) {
    if (summary === undefined) return null;
    return (
      <p aria-live="polite" className={cn("text-center text-sm text-muted tabular-nums", className)}>
        {summary}
      </p>
    );
  }
  const detail = summary ?? (itemCount !== undefined ? `${String(itemCount)} ${itemLabel}` : undefined);
  const size = compact ? "sm" : "md";
  return (
    <nav aria-label={strings.pagination} className={cn("flex items-center justify-center gap-3", className)}>
      <Button
        size={size}
        leadingIcon={ChevronLeft}
        disabled={page <= 0}
        onClick={() => {
          onPageChange(page - 1);
        }}
      >
        {strings.previous}
      </Button>
      <span aria-live="polite" className="text-sm text-muted tabular-nums">
        {strings.page(page + 1, pageCount)}
        {detail !== undefined && ` · ${detail}`}
      </span>
      <Button
        size={size}
        trailingIcon={ChevronRight}
        disabled={page >= pageCount - 1}
        onClick={() => {
          onPageChange(page + 1);
        }}
      >
        {strings.next}
      </Button>
    </nav>
  );
}
