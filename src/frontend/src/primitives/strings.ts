/**
 * Every built-in text of the primitives (labels, status words, accessible
 * names). The product UI is English. Keeping them in
 * one place makes a later i18n step a change to this file only.
 */
export const strings = {
  busy: "Working…",
  loading: "Loading…",
  close: "Close",
  dismiss: "Dismiss",
  clearSearch: "Clear search",
  notifications: "Notifications",
  pagination: "Pagination",
  previous: "Previous",
  next: "Next",
  page: (page: number, pageCount: number) => `Page ${String(page)} of ${String(pageCount)}`,
  confirm: "Confirm",
  cancel: "Cancel",
  expand: "Expand",
  collapse: "Collapse",
  noResults: "No results.",
  treeStatus: {
    owned: "Owned",
    craftable: "Craftable",
    partial: "Partial",
    missing: "Missing",
  },
} as const;
