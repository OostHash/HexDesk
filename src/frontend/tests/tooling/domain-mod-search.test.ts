import { describe, expect, it } from "vitest";
import type { CardMeta } from "../../src/domain/items.ts";
import { matchMod } from "../../src/domain/modSearch.ts";

const meta = (patch: Partial<CardMeta>): CardMeta => ({
  rarity: "Common",
  polarity: "madurai",
  compat: "Rifle",
  type_name: "Primary Mod",
  max_rank: 5,
  augment: false,
  exilus: false,
  utility: false,
  damage_types: [],
  effect: [],
  ...patch,
});

const cryo = meta({ damage_types: ["Cold"], effect: ["+90% Cold"] });
const viral = meta({ damage_types: ["Viral"], rarity: "Rare" });
const heatInText = meta({ effect: ["+27% Turret Heat Capacity"], compat: "Railjack", type_name: "Plexus Mod" });

describe("mod search", () => {
  it("matches the name as a whole", () => {
    expect(matchMod("cryo rou", "Cryo Rounds", cryo)).toEqual({ matched: true, reason: null });
  });

  it("finds a combined element and the elements that build it", () => {
    expect(matchMod("viral", "Cryo Rounds", cryo)).toEqual({ matched: true, reason: "Cold, builds Viral" });
    expect(matchMod("viral", "Hemorrhage", viral)).toEqual({ matched: true, reason: "Viral" });
    expect(matchMod("blast", "Cryo Rounds", cryo).reason).toBe("Cold, builds Blast");
    expect(matchMod("corrosive", "Cryo Rounds", cryo).matched).toBe(false);
  });

  it("takes the start of a damage type from three letters", () => {
    expect(matchMod("vir", "Cryo Rounds", cryo).reason).toBe("Cold, builds Viral");
  });

  it("counts damage types only from tags, not from words in the effect", () => {
    expect(matchMod("heat", "Battle Forge", heatInText)).toEqual({ matched: true, reason: "+27% Turret Heat Capacity" });
    expect(matchMod("radiation", "Battle Forge", heatInText).matched).toBe(false);
  });

  it("matches what a mod fits, polarity, rarity and traits", () => {
    expect(matchMod("rifle", "Cryo Rounds", cryo).reason).toBe("Fits Rifle");
    expect(matchMod("madu", "Cryo Rounds", cryo).reason).toBe("Madurai polarity");
    expect(matchMod("rare", "Hemorrhage", viral).reason).toBe("Rare");
    expect(matchMod("exilus", "X", meta({ exilus: true })).reason).toBe("Exilus");
    expect(matchMod("augment", "X", meta({})).matched).toBe(false);
  });

  it("needs every word to match and lists each reason once", () => {
    expect(matchMod("rifle viral", "Cryo Rounds", cryo)).toEqual({ matched: true, reason: "Fits Rifle · Cold, builds Viral" });
    expect(matchMod("rifle toxin", "Cryo Rounds", cryo).matched).toBe(false);
  });

  it("matches only the name without card facts", () => {
    expect(matchMod("viral", "Unknown Mod", undefined).matched).toBe(false);
    expect(matchMod("unknown", "Unknown Mod", undefined).matched).toBe(true);
  });
});
