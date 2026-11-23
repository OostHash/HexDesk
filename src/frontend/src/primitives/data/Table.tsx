import { createSortedRowModel, rowSortingFeature, tableFeatures, useTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { Skeleton } from "../display/Skeleton";
import { strings } from "../strings";

export type { SortingState };

/**
 * Column description for Table. Screens describe columns with this small
 * type; TanStack Table stays an implementation detail of the primitive.
 */
export type TableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable by this value. */
  sortValue?: (row: T) => string | number;
  align?: "start" | "end";
  /** Header is visually hidden but stays the column's accessible name (e.g. an actions column). */
  hideHeader?: boolean;
};

type Props<T> = {
  /** Accessible name (caption) of the table. */
  label: string;
  columns: ReadonlyArray<TableColumn<T>>;
  data: readonly T[];
  getRowId: (row: T) => string;
  /** Controlled sorting (optional). */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  /** Virtualize rows above this count (default 100). The table then needs a height via className. */
  virtualizeAbove?: number;
  /** Shown instead of rows when data is empty. */
  empty?: ReactNode;
  loading?: boolean;
  /** Scrolls the table back to the top when this changes (e.g. the page of a pager). */
  scrollTopKey?: unknown;
  className?: string;
};

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
type Row = object;
const ESTIMATED_ROW_HEIGHT = 32;

/**
 * Semantic <table> with sticky header, sortable columns (aria-sort) and row
 * virtualisation for long lists. Row height and text follow
 * density (h-control-*, text-list, cell padding).
 */
export function Table<T>({
  label,
  columns,
  data,
  getRowId,
  sorting: controlledSorting,
  onSortingChange,
  virtualizeAbove = 100,
  empty,
  loading = false,
  scrollTopKey,
  className,
}: Props<T>) {
  const [ownSorting, setOwnSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? ownSorting;
  const setSorting = (next: SortingState) => {
    if (onSortingChange) onSortingChange(next);
    else setOwnSorting(next);
  };

  const tableColumns = useMemo(
    (): Array<ColumnDef<typeof features, Row>> =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        accessorFn: (row: Row) => (column.sortValue ? column.sortValue(row as T) : ""),
        enableSorting: column.sortValue !== undefined,
        // TanStack sorts numbers descending first by default; always start ascending.
        sortDescFirst: false,
      })),
    [columns],
  );

  const table = useTable({
    features,
    columns: tableColumns,
    data: data as readonly Row[],
    getRowId: (row) => getRowId(row as T),
    state: { sorting },
    onSortingChange: (updater) => {
      setSorting(typeof updater === "function" ? updater(sorting) : updater);
    },
  });

  const rows = table.getRowModel().rows;
  const virtual = rows.length > virtualizeAbove;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollTopKey]);
  // TanStack Virtual returns non-memoizable functions; we do not use the React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const visible = virtual ? virtualItems.map((item) => ({ row: rows[item.index], index: item.index })) : rows.map((row, index) => ({ row, index }));
  const padTop = virtual ? (virtualItems[0]?.start ?? 0) : 0;
  const padBottom = virtual ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0) : 0;
  const columnById = new Map(columns.map((column) => [column.id, column]));

  return (
    // The wrapper scrolls (narrow windows, long lists), so keyboard users must
    // be able to focus it (WCAG 2.1.1, axe scrollable-region-focusable).
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region is operable
      tabIndex={0}
      className={cn(
        "min-h-0 overflow-auto rounded-lg border border-border outline-none focus-visible:outline-2 focus-visible:outline-focus",
        className,
      )}
    >
      <table aria-rowcount={rows.length + 1} className="w-full border-collapse text-list text-text">
        <caption className="sr-only">{label}</caption>
        <thead className="sticky top-0 z-(--hex-z-sticky) bg-surface">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} aria-rowindex={1}>
              {group.headers.map((header) => {
                const column = columnById.get(header.column.id);
                const sorted = header.column.getIsSorted();
                const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined;
                const alignEnd = column?.align === "end";
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={header.column.getCanSort() ? (ariaSort ?? "none") : undefined}
                    className={cn(
                      "border-b border-border px-cell-x py-cell-y text-xs font-medium whitespace-nowrap text-muted",
                      alignEnd ? "text-end" : "text-start",
                    )}
                  >
                    {column?.hideHeader ? (
                      <span className="sr-only">{column.header}</span>
                    ) : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn("inline-flex items-center gap-1 rounded-sm hover:text-text", alignEnd && "flex-row-reverse")}
                      >
                        {column?.header}
                        <Icon
                          icon={sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown}
                          size="xs"
                          className={sorted ? "text-text" : "text-faint"}
                        />
                      </button>
                    ) : (
                      column?.header
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-cell-x py-3">
                <Skeleton lines={3} />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty ?? <p className="px-cell-x py-6 text-center text-muted">{strings.noResults}</p>}</td>
            </tr>
          ) : (
            <>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: padTop, padding: 0 }} />
                </tr>
              )}
              {visible.map(({ row, index }) =>
                row ? (
                  <tr key={row.id} aria-rowindex={index + 2} className="border-b border-border/60 last:border-b-0 hover:bg-hover">
                    {columns.map((column) => (
                      <td key={column.id} className={cn("px-cell-x py-cell-y", column.align === "end" ? "text-end tabular-nums" : "text-start")}>
                        {column.cell(row.original as T)}
                      </td>
                    ))}
                  </tr>
                ) : null,
              )}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: padBottom, padding: 0 }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
