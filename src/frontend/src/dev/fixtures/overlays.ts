import type { CatalogItem } from "../../domain/relics";
import type { BackendCard } from "../../domain/relicReward";
import { noResult } from "./market";
import type { Fixture } from "./scenario";

/** A small prime catalogue for the relic reward overlay (paths use the catalogue form). */
export const OVERLAY_CATALOG: CatalogItem[] = [
  { unique_name: "/Lotus/Powersuits/Rhino/RhinoPrime", name: "Rhino Prime", category: "Warframes", vaulted: true },
  {
    unique_name: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeBlueprint",
    name: "Rhino Prime Blueprint",
    category: "Blueprints",
    vaulted: true,
    ducats: 15,
  },
  {
    unique_name: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeChassisBlueprint",
    name: "Rhino Prime Chassis Blueprint",
    category: "Blueprints",
    vaulted: true,
    ducats: 45,
  },
  {
    unique_name: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeHelmetBlueprint",
    name: "Rhino Prime Neuroptics Blueprint",
    category: "Blueprints",
    vaulted: true,
    ducats: 100,
  },
  {
    unique_name: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeSystemsBlueprint",
    name: "Rhino Prime Systems Blueprint",
    category: "Blueprints",
    vaulted: true,
    ducats: 45,
  },
  { unique_name: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell", category: "Resources" },
  {
    unique_name: "/Lotus/Weapons/Tenno/Melee/Glaive/PrimeGlaive/PrimeGlaiveDisc",
    name: "Glaive Prime Disc",
    category: "Parts",
    vaulted: true,
    ducats: 45,
  },
  { unique_name: "/Lotus/Types/Items/MiscItems/Forma", name: "Forma Blueprint", category: "Blueprints", ducats: 0 },
];

export const OVERLAY_PRICES: Record<string, number> = {
  "Rhino Prime Blueprint": 20,
  "Rhino Prime Chassis Blueprint": 9,
  "Rhino Prime Neuroptics Blueprint": 12,
  "Rhino Prime Systems Blueprint": 7,
  "Glaive Prime Disc": 9,
};

export const overlayFixtures = {
  get_warframe_window_rect: { alwaysDefault: true, default: () => [0, 0, 1920, 1080] } satisfies Fixture<[number, number, number, number]>,
  show_overlay_window: noResult<{ x: number; y: number; w: number; h: number }>(),
  move_overlay_offscreen: noResult(),
  get_pending_relic_rewards: { alwaysDefault: true, default: () => null } satisfies Fixture<{ items: string[]; positions: number[] } | null>,
  get_reward_cards: { default: () => [], empty: () => [] } satisfies Fixture<BackendCard[], { paths: string[] }>,
  get_items_by_paths: { default: () => OVERLAY_CATALOG, empty: () => [] } satisfies Fixture<CatalogItem[], { paths: string[] }>,
  get_item_price: { default: ({ itemName }) => OVERLAY_PRICES[itemName] ?? null, empty: () => null } satisfies Fixture<
    number | null,
    { itemName: string }
  >,
  get_current_crafting: { default: () => [], empty: () => [] } satisfies Fixture<
    Array<{ unique_name: string; item_name: string; completion_ms: number }>
  >,
  set_overlays_enabled: noResult<{ enabled: boolean }>(),
  test_report_flows: { alwaysDefault: true, default: () => 3 } satisfies Fixture<number>,
  export_test_report: {
    alwaysDefault: true,
    default: () => "C:/Users/Tenno/Downloads/hexdesk-test-report-2026-11-21-201544.zip",
  } satisfies Fixture<string>,
  discard_test_report: noResult(),
  set_relic_pick_enabled: noResult<{ enabled: boolean }>(),
  set_relic_reward_enabled: noResult<{ enabled: boolean }>(),
  set_riven_enabled: noResult<{ enabled: boolean }>(),
  set_overlay_manual: noResult<{ enabled: boolean }>(),
  set_overlay_key: noResult<{ vk: number }>(),
  set_testing_keys: noResult<{ correct: number; wrong: number }>(),
  set_overlay_key_capture: noResult<{ enabled: boolean }>(),
  set_overlay_screenshot: noResult<{ enabled: boolean }>(),
  set_overlay_areas: noResult<{ enabled: boolean }>(),
  get_capture: { default: () => new ArrayBuffer(0) } satisfies Fixture<ArrayBuffer, { name: string }>,
  check_riven: noResult(),
  show_riven_window: noResult(),
  log_relic_fe: noResult<{ msg: string }>(),
  show_relic_pick_window: noResult(),
  park_relic_pick_window: noResult(),
  show_overlay_status_window: noResult(),
  overlay_closed: noResult(),
  overlay_rendered: noResult<{ overlay: "relic_pick" | "relic_reward" | "riven"; view: number; summary: string }>(),
};
