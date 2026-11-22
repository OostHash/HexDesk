import type { CommandArgs, CommandName, CommandResult } from "../../api/commands";
import { resolveFixture, type Fixture, type Scenario } from "./scenario";
import { OWNED_QUANTITIES, researchLabStores, savedInventory, syndicateStores, weaponCatalog } from "./completionist";
import { allItems, dropData, RELIC_QUANTITIES, wfmItems, wfmPrices } from "./relics";
import { craftableItems, FOUNDRY_QUANTITIES, FOUNDRY_RELICS, recipesBulk, relicDrops } from "./foundry";
import {
  createOrder,
  itemInfo,
  itemOrders,
  itemStatistics,
  MARKET_ITEMS,
  MARKET_PRICES,
  MARKET_QUANTITIES,
  MARKET_WFM_ITEMS,
  noResult,
} from "./market";
import { rivenFixtures } from "./rivens";
import { statisticsFixtures } from "./statistics";
import { tradingFixtures } from "./trading";
import { bulkPrices, changeLog, INVENTORY_ITEMS, INVENTORY_QUANTITIES, itemListStatus } from "./inventory";
import { appFixtures } from "./app";
import { overlayFixtures } from "./overlays";
import { debugFixtures } from "./debug";
import { loadSettings, saveSettings, setOcrModels } from "./settings";
import { worldstate } from "./worldstate";

type Fixtures = { [C in CommandName]: Fixture<CommandResult<C>, CommandArgs<C>> };

/** One fixture per command in api/commands.ts; the type enforces completeness. */
export const fixtures: Fixtures = {
  fetch_worldstate: worldstate,
  load_settings: loadSettings,
  save_settings: saveSettings,
  set_ocr_models: setOcrModels,
  get_current_quantities: {
    default: () => ({
      "/Mods/PrimedContinuity": 1,
      "/Warframes/MagPrime": 1,
      ...OWNED_QUANTITIES,
      ...RELIC_QUANTITIES,
      ...INVENTORY_QUANTITIES,
      ...FOUNDRY_QUANTITIES,
      ...MARKET_QUANTITIES,
    }),
    empty: () => ({}),
  },
  get_saved_inventory: savedInventory,
  get_syndicate_stores: syndicateStores,
  get_research_lab_stores: researchLabStores,
  get_weapon_catalog: weaponCatalog,
  // No image server in mock mode: images use their fallback, so screenshots never hit the network.
  get_img_cache_dir: { default: () => "" },
  get_all_items: { default: (args) => [...allItems.default(args), ...INVENTORY_ITEMS, ...FOUNDRY_RELICS, ...MARKET_ITEMS], empty: () => [] },
  get_drop_data: dropData,
  fetch_wfm_items: { default: (args) => [...wfmItems.default(args), ...MARKET_WFM_ITEMS], empty: () => [] },
  wfm_get_cached_prices: { default: (args) => ({ ...wfmPrices.default(args), ...MARKET_PRICES }), empty: () => ({}) },
  get_bulk_prices: bulkPrices,
  get_change_log: changeLog,
  get_item_list_status: itemListStatus,
  get_craftable_items: craftableItems,
  get_recipes_bulk: recipesBulk,
  get_relic_drops: relicDrops,
  start_wfm_queue: noResult(),
  wfm_queue_prices: noResult(),
  wfm_queue_price_priority: noResult(),
  wfm_get_item_info: itemInfo,
  wfm_get_item_statistics: itemStatistics,
  wfm_get_item_orders: itemOrders,
  wfm_create_order: createOrder,
  wfm_refresh_token: noResult(),
  ...tradingFixtures,
  ...rivenFixtures,
  ...statisticsFixtures,
  ...appFixtures,
  ...overlayFixtures,
  ...debugFixtures,
};

/** Tauri plugin commands used by the app; answered the same in every scenario. */
const pluginHandlers: Record<string, (args: unknown) => unknown> = {
  "plugin:notification|is_permission_granted": () => true,
  "plugin:notification|request_permission": () => "granted",
  "plugin:notification|notify": () => null,
  "plugin:opener|open_url": () => null,
  // Pop-out windows: mock mode has only the main window and opens none.
  "plugin:window|get_all_windows": () => ["main"],
  "plugin:webview|create_webview_window": () => null,
  // Overlay windows: click-through, size and hide do nothing in a browser tab.
  "plugin:window|set_ignore_cursor_events": () => null,
  "plugin:window|set_size": () => null,
  "plugin:window|hide": () => null,
  "plugin:window|current_monitor": () => null,
  "plugin:window|available_monitors": () => [],
  // Text scale zooms the desktop webview; a browser tab keeps its own zoom.
  "plugin:webview|set_webview_zoom": () => null,
};

const isCommand = (cmd: string): cmd is CommandName => Object.hasOwn(fixtures, cmd);

export function handleCommand(cmd: string, args: unknown, scenario: Scenario): Promise<unknown> {
  const plugin = pluginHandlers[cmd];
  if (plugin) return Promise.resolve(plugin(args));
  if (!isCommand(cmd)) {
    return Promise.reject(new Error(`mock: no fixture for command "${cmd}"`));
  }
  return resolveFixture(fixtures[cmd] as Fixture<unknown, unknown>, args, scenario, cmd);
}
