/** Relic reward overlay: the backend's cards with prices, the best pick and the layout. Pure functions. */

export const OVERLAY_PRIORITIES = ["completion", "setPlat", "plat", "ducat"] as const;
export type OverlayPriority = (typeof OVERLAY_PRIORITIES)[number];
export const overlayPriorityFrom = (v: unknown): OverlayPriority =>
  (OVERLAY_PRIORITIES as readonly unknown[]).includes(v) ? (v as OverlayPriority) : "completion";
export const OVERLAY_PRIORITY_LABEL: Readonly<Record<OverlayPriority, string>> = {
  completion: "Item completion",
  setPlat: "Most set value (platinum)",
  plat: "Most platinum (item)",
  ducat: "Most ducats",
};

export type RewardComponent = { unique_name: string; name: string; needed: number; owned: number; plat?: number; ducats?: number };

export type RewardCard = {
  /** Path plus slot index: unique per card. */
  key: string;
  name: string;
  unknown: boolean;
  /** Matched, but the reads disagreed or only part of the name was read. */
  uncertain?: boolean;
  category?: string;
  vaulted?: boolean;
  ducats?: number;
  plat?: number;
  setName?: string;
  components?: RewardComponent[];
  completeSets?: number;
  missingPlat?: number;
  totalPlat?: number;
};

// ── Set names ───────────────────────────────────────────────────────────────

/** "Rhino Prime Chassis Blueprint" in set "Rhino Prime" → "Chassis Blueprint". */
export const shortName = (fullName: string, setName: string) => (fullName.startsWith(`${setName} `) ? fullName.slice(setName.length + 1) : fullName);

/** Cell label: the short name without a trailing " Blueprint" (a lone "Blueprint" stays). */
export function cellLabel(fullName: string, setName: string): string {
  const s = shortName(fullName, setName);
  return s !== "Blueprint" && s.endsWith(" Blueprint") ? s.slice(0, -" Blueprint".length) : s;
}

/**
 * A reward card as the backend builds it (src/backend/crates/player/src/sets.rs):
 * the item, and for a set item its parts with how many the player has.
 */
export type BackendCard = {
  path: string;
  name: string;
  unknown: boolean;
  category: string | null;
  vaulted: boolean | null;
  ducats: number | null;
  set_name: string | null;
  parts: Array<{ path: string; name: string; needed: number; owned: { total: number }; ducats: number | null }> | null;
  built: { total: number } | null;
  complete_sets: number | null;
};

/** The cards to draw: the backend's cards with platinum prices added. */
export function cardsFrom(cards: readonly BackendCard[], prices: ReadonlyMap<string, number>): RewardCard[] {
  return cards.map((c, i) => {
    const key = `${c.path}-${String(i)}`;
    if (c.unknown) return { key, name: c.name, unknown: true, category: "Unrecognized" };
    const plat = prices.get(c.name);
    const card: RewardCard = {
      key,
      name: c.name,
      unknown: false,
      ...(c.category != null ? { category: c.category } : {}),
      ...(c.vaulted != null ? { vaulted: c.vaulted } : {}),
      ...(c.ducats != null ? { ducats: c.ducats } : {}),
      ...(plat !== undefined ? { plat } : {}),
    };
    if (!c.parts || !c.set_name) return card;
    const components: RewardComponent[] = c.parts.map((p) => {
      const price = prices.get(p.name);
      return {
        unique_name: p.path,
        name: p.name,
        needed: p.needed,
        owned: p.owned.total,
        ...(price !== undefined ? { plat: price } : {}),
        ...(p.ducats != null ? { ducats: p.ducats } : {}),
      };
    });
    const { missing, total } = setPlatinum(components);
    return { ...card, setName: c.set_name, components, completeSets: c.complete_sets ?? 0, missingPlat: missing, totalPlat: total };
  });
}

/** Platinum still missing and the whole set's value, from known part prices. */
export function setPlatinum(components: readonly RewardComponent[]): { missing: number; total: number } {
  let missing = 0;
  let total = 0;
  for (const c of components) {
    if (c.plat == null) continue;
    total += c.plat * c.needed;
    if (c.owned < c.needed) missing += c.plat * (c.needed - c.owned);
  }
  return { missing, total };
}

/** Index of the card to pick, or -1 when no card scores above 0. */
export function bestPick(cards: readonly RewardCard[], priority: OverlayPriority): number {
  const score = (card: RewardCard): number => {
    switch (priority) {
      case "plat":
        return card.plat ?? 0;
      case "ducat":
        return card.ducats ?? 0;
      case "setPlat":
        return card.missingPlat ?? card.plat ?? 0;
      case "completion": {
        if (!card.components || !card.setName) return card.plat ?? 0;
        const setName = card.setName;
        const self = card.components.find((c) => shortName(c.name, setName) === shortName(card.name, setName));
        if (!self) return 0;
        const stillNeed = self.needed - self.owned;
        if (stillNeed <= 0) return -1;
        const totalNeeded = card.components.reduce((a, c) => a + Math.max(0, c.needed - c.owned), 0);
        return stillNeed * 100 - totalNeeded;
      }
    }
  };
  let best = -1;
  let bestScore = 0;
  cards.forEach((card, i) => {
    const s = score(card);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

// ── Layout ──────────────────────────────────────────────────────────────────

/** Distance between reward columns as a share of the game width (measured in game). */
export const COLUMN_SPACING = 0.127;

/** Column centres symmetric around the middle, matching the game's slots. */
export function columnCenters(width: number, n: number): number[] {
  const s = width * COLUMN_SPACING;
  const c = width / 2;
  if (n <= 1) return [c];
  if (n === 2) return [c - 0.5 * s, c + 0.5 * s];
  if (n === 3) return [c - s, c, c + s];
  return [c - 1.5 * s, c - 0.5 * s, c + 0.5 * s, c + 1.5 * s];
}

export const cardWidth = (width: number) => Math.max(80, Math.round(width * COLUMN_SPACING - 10));

// ── Window placement ────────────────────────────────────────────────────────

/** The strip as a share of the game window: on trigger, and when rewards arrive first. */
export const STRIP = { trigger: { top: 0.6, height: 0.3 }, rewards: { top: 0.54, height: 0.28 } } as const;

/** Strip bounds in physical pixels; never past the game window's bottom. */
export function stripBounds(
  rect: readonly [number, number, number, number],
  strip: { top: number; height: number },
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = rect;
  const offset = Math.round(h * strip.top);
  return { x, y: y + offset, w, h: Math.min(Math.round(h * strip.height * scale), h - offset) };
}

// ── Preview ─────────────────────────────────────────────────────────────────

/** What Settings → Overlays → Show draws: example cards. */
export const PREVIEW_CARDS: readonly RewardCard[] = [
  {
    key: "preview-0",
    name: "Rhino Prime Blueprint",
    unknown: false,
    category: "Blueprints",
    vaulted: true,
    plat: 20,
    ducats: 100,
    setName: "Rhino Prime",
    completeSets: 0,
    totalPlat: 48,
    missingPlat: 32,
    components: [
      { unique_name: "rp-bp", name: "Rhino Prime Blueprint", needed: 1, owned: 0, plat: 20, ducats: 15 },
      { unique_name: "rp-ch", name: "Rhino Prime Chassis Blueprint", needed: 1, owned: 1, plat: 9, ducats: 45 },
      { unique_name: "rp-ne", name: "Rhino Prime Neuroptics Blueprint", needed: 1, owned: 0, plat: 12, ducats: 90 },
      { unique_name: "rp-sy", name: "Rhino Prime Systems Blueprint", needed: 1, owned: 1, plat: 7, ducats: 45 },
    ],
  },
  {
    key: "preview-1",
    name: "Nyx Prime Neuroptics Blueprint",
    unknown: false,
    category: "Blueprints",
    vaulted: true,
    plat: 30,
    ducats: 100,
    setName: "Nyx Prime",
    completeSets: 1,
    totalPlat: 56,
    missingPlat: 0,
    components: [
      { unique_name: "nx-bp", name: "Nyx Prime Blueprint", needed: 1, owned: 1, plat: 9, ducats: 15 },
      { unique_name: "nx-ch", name: "Nyx Prime Chassis Blueprint", needed: 1, owned: 1, plat: 9, ducats: 45 },
      { unique_name: "nx-ne", name: "Nyx Prime Neuroptics Blueprint", needed: 1, owned: 1, plat: 30, ducats: 100 },
      { unique_name: "nx-sy", name: "Nyx Prime Systems Blueprint", needed: 1, owned: 1, plat: 8, ducats: 45 },
    ],
  },
  { key: "preview-2", name: "Glaive Prime Disc", unknown: false, category: "Parts", vaulted: true, plat: 9, ducats: 45 },
  { key: "preview-3", name: "Spira Prime Pouch", unknown: false, category: "Parts", vaulted: true, plat: 35, ducats: 100 },
];

// ── Everything together ─────────────────────────────────────────────────────

/** Every item name whose price a card shows: the rewards and their set parts. */
export function priceNames(cards: readonly RewardCard[]): string[] {
  const names = new Set<string>();
  for (const c of cards) {
    if (c.unknown) continue;
    names.add(c.name);
    for (const part of c.components ?? []) names.add(part.name);
  }
  return [...names];
}

/** The cards with prices, set parts, ownership and set value, from what is loaded so far. */

/** One line per card for the backend log: what the overlay shows and why. */
export function rewardSummary(cards: readonly RewardCard[]): string {
  return cards
    .map((c) => {
      if (c.unknown) return `? ${c.name}`;
      const plat = c.plat !== undefined ? ` ${String(c.plat)}p` : "";
      if (!c.components) return `${c.name}${plat}`;
      const prefix = c.setName ? `${c.setName} ` : "";
      const parts = c.components.map((p) => `${p.name.replace(prefix, "")} ${String(p.owned)}/${String(p.needed)}`).join(", ");
      const full = (c.completeSets ?? 0) >= 1 ? "full item owned" : "full item not owned";
      return `${c.name}${plat}: ${full} (${parts})`;
    })
    .join(" | ");
}
