import type { FoundryItem, RecipeComponent } from "../../domain/foundry";
import type { CatalogItem } from "../../domain/relics";
import type { Fixture } from "./scenario";

/**
 * Foundry: one item per card state (missing, partial with blueprint and
 * relic, ready, owned + mastered with Forma and shards, subsumed, building,
 * Lich weapon, acquired in-game) and enough fillers for two pages.
 */
const part = (unique_name: string, name: string, count = 1, components: RecipeComponent[] = []): RecipeComponent => ({
  unique_name,
  name,
  count,
  result_count: 1,
  components,
});

const FILLER_NAMES = [
  "Skana",
  "Bo",
  "Kronen",
  "Nikana",
  "Galatine",
  "Orthos",
  "Dual Zoren",
  "Fragor",
  "Gram",
  "Scindo",
  "Tipedo",
  "Heat Sword",
  "Jat Kittag",
  "Lesion",
  "Ninkondi",
  "Ohma",
  "Pangolin Sword",
  "Plague Kripath",
  "Reaper Prime",
  "Sibear",
  "Tonbo",
  "Venka",
  "War",
  "Zenistar",
  "Kogake",
  "Hirudo",
  "Furax",
  "Ankyros",
];

export const FOUNDRY_ITEMS: FoundryItem[] = [
  { unique_name: "/Foundry/ExcaliburPrime", name: "Excalibur Prime", category: "Warframes", vaulted: true, masterable: true },
  { unique_name: "/Foundry/BratonPrime", name: "Braton Prime", category: "Primary", vaulted: false, masterable: true, mastery_req: 8 },
  { unique_name: "/Foundry/Volt", name: "Volt", category: "Warframes", masterable: true },
  { unique_name: "/Warframes/Rhino", name: "Rhino", category: "Warframes", masterable: true },
  { unique_name: "/Foundry/Forma", name: "Forma", category: "Miscellaneous", masterable: false },
  { unique_name: "/Foundry/KuvaBramma", name: "Kuva Bramma", category: "Primary", masterable: true, mastery_req: 13, max_level_cap: 40 },
  { unique_name: "/Foundry/ExcaliburUmbra", name: "Excalibur Umbra", category: "Warframes", masterable: true, source_type: "Quest" },
  { unique_name: "/Foundry/ExcaliburPrimeChassis", name: "Excalibur Prime Chassis", category: "Parts", vaulted: true, masterable: false },
  ...FILLER_NAMES.map((name, i) => ({
    unique_name: `/Foundry/Melee/${name.replace(/\s+/g, "")}`,
    name,
    category: "Melee",
    masterable: true,
    mastery_req: i % 9,
  })),
];

const excaliburRecipe = [
  part("/Foundry/ExcaliburPrimeBlueprint", "Excalibur Prime Blueprint"),
  part("/Foundry/ExcaliburPrimeChassis", "Excalibur Prime Chassis", 1, [
    part("/Foundry/ExcaliburPrimeChassisBlueprint", "Excalibur Prime Chassis Blueprint"),
    part("/Res/Ferrite", "Ferrite", 1000),
    part("/Res/OrokinCell", "Orokin Cell", 5),
  ]),
  part("/Foundry/ExcaliburPrimeNeuroptics", "Excalibur Prime Neuroptics", 1, [
    part("/Foundry/ExcaliburPrimeNeuropticsBlueprint", "Excalibur Prime Neuroptics Blueprint"),
    part("/Res/Neurodes", "Neurodes", 3),
    part("/Res/Plastids", "Plastids", 900),
  ]),
  part("/Foundry/ExcaliburPrimeSystems", "Excalibur Prime Systems", 1, [
    part("/Foundry/ExcaliburPrimeSystemsBlueprint", "Excalibur Prime Systems Blueprint"),
    part("/Res/OrokinCell", "Orokin Cell", 20),
  ]),
];

export const FOUNDRY_RECIPES: Record<string, RecipeComponent[]> = {
  "/Foundry/ExcaliburPrime": excaliburRecipe,
  "/Foundry/ExcaliburPrimeChassis": excaliburRecipe[1]?.components ?? [],
  "/Foundry/BratonPrime": [
    part("/Foundry/BratonPrimeBlueprint", "Braton Prime Blueprint"),
    part("/Foundry/BratonPrimeBarrel", "Braton Prime Barrel"),
    part("/Foundry/BratonPrimeReceiver", "Braton Prime Receiver"),
    part("/Foundry/BratonPrimeStock", "Braton Prime Stock"),
  ],
  "/Foundry/Volt": [part("/Foundry/VoltBlueprint", "Volt Blueprint"), part("/Foundry/VoltChassis", "Volt Chassis")],
  "/Warframes/Rhino": [part("/Foundry/RhinoBlueprint", "Rhino Blueprint"), part("/Foundry/RhinoChassis", "Rhino Chassis")],
  "/Foundry/Forma": [part("/Foundry/FormaBlueprint", "Forma Blueprint"), part("/Res/OrokinCell", "Orokin Cell")],
  "/Foundry/KuvaBramma": [part("/Foundry/KuvaBrammaBlueprint", "Kuva Bramma Blueprint")],
  ...Object.fromEntries(
    FILLER_NAMES.map((name) => {
      const id = name.replace(/\s+/g, "");
      return [`/Foundry/Melee/${id}`, [part(`/Foundry/Melee/${id}Blueprint`, `${name} Blueprint`), part("/Res/Ferrite", "Ferrite", 500)]];
    }),
  ),
};

/** Relics in the real Bronze/Silver/Gold/Platinum form the drop map uses. */
export const FOUNDRY_RELICS: CatalogItem[] = [
  { unique_name: "/Relics/NeoS1Bronze", name: "Neo S1 Intact", category: "Relics" },
  { unique_name: "/Relics/NeoS1Gold", name: "Neo S1 Flawless", category: "Relics" },
  { unique_name: "/Relics/AxiS2Bronze", name: "Axi S2 Intact", category: "Relics" },
];

export const FOUNDRY_QUANTITIES: Record<string, number> = {
  "/Foundry/ExcaliburPrimeBlueprint": 1,
  "/Foundry/ExcaliburPrimeChassis": 1,
  "/Foundry/ExcaliburPrimeNeuropticsBlueprint": 1,
  "/Res/Neurodes": 1,
  "/Foundry/BratonPrimeBlueprint": 1,
  "/Foundry/BratonPrimeBarrel": 1,
  "/Foundry/BratonPrimeReceiver": 1,
  "/Foundry/BratonPrimeStock": 2,
  "/Foundry/Volt": 1,
  "/Warframes/Rhino": 1,
  "/Relics/NeoS1Gold": 2,
};

export const FOUNDRY_MASTERY: Record<string, number> = { "/Foundry/Volt": 30, "/Foundry/Melee/Skana": 30 };

export const FOUNDRY_CRAFTING = [{ unique_name: "/Foundry/FormaBlueprint", item_name: "Forma", completion_ms: Date.now() + 23 * 3_600_000 }];

export const FOUNDRY_SHARDS = {
  "/Foundry/Volt": [
    { upgrade_type: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeAbilityStrength", color: "ACC_RED" },
    { upgrade_type: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeCastingSpeed", color: "ACC_YELLOW_MYTHIC" },
    { upgrade_type: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeHealthMax", color: "ACC_BLUE" },
  ],
};

export const FOUNDRY_FORMA: Record<string, number> = { "/Foundry/Volt": 3 };

export const RELIC_DROPS: Record<string, string[]> = {
  "/Foundry/ExcaliburPrimeSystemsBlueprint": ["/Relics/NeoS1Bronze", "/Relics/AxiS2Bronze"],
  "/Foundry/ExcaliburPrimeSystems": ["/Relics/NeoS1Bronze"],
  // A missing Prime Sets part that an owned relic drops.
  "/Prime/Braton/Barrel": ["/Relics/NeoS1Bronze"],
};

export const craftableItems: Fixture<FoundryItem[]> = { default: () => FOUNDRY_ITEMS, empty: () => [] };

export const recipesBulk: Fixture<Record<string, RecipeComponent[]>, { uniqueNames: string[] }> = {
  default: ({ uniqueNames }) => Object.fromEntries(uniqueNames.map((id) => [id, FOUNDRY_RECIPES[id] ?? []])),
};

export const relicDrops: Fixture<Record<string, string[]>> = { default: () => RELIC_DROPS, empty: () => ({}) };
