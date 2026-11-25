/**
 * Shared look of the in-game overlays. An overlay is read in a glance over a
 * moving game scene, so it differs from a desktop panel on purpose:
 * - surfaces are opaque, so muted text keeps its contrast over bright scenes;
 * - the outer edge uses border-strong, so the card stands apart from the game;
 * - body text is text-sm and nothing is smaller than text-xs;
 * - the one thing to act on (best pick, current relic) gets a 2px accent edge
 *   and a label, never colour alone.
 */

/** The outer card of an overlay. */
export const OVERLAY_PANEL = "rounded-lg border border-border-strong bg-surface text-sm text-text shadow-2";

/** A highlighted outer card: the best pick or the item to act on. */
export const OVERLAY_PANEL_HIGHLIGHT = "border-2 border-accent";

/** A card inside an overlay panel, such as one relic in the pick list. */
export const OVERLAY_INSET = "rounded-md border border-border bg-surface-sunken";

/** A small section title inside an overlay. */
export const OVERLAY_HEADING = "text-xs font-semibold tracking-wide text-muted uppercase";

/** The divider between sections or rows of an overlay. */
export const OVERLAY_DIVIDER = "border-border";
