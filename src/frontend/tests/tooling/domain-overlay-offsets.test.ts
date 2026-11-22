import { expect, it } from "vitest";
import { clampOffset, NO_OFFSETS, offsetDraft, offsetOf, offsetsFrom, withOffset } from "../../src/domain/overlayOffsets";

it("reads and clamps saved offsets", () => {
  expect(offsetsFrom({ rivenX: 12.4, rivenY: -9000, relicX: "x" })).toEqual({ ...NO_OFFSETS, rivenX: 12, rivenY: -3000 });
  expect(offsetsFrom(undefined)).toEqual(NO_OFFSETS);
  expect(offsetsFrom("nope")).toEqual(NO_OFFSETS);
  expect(clampOffset(Number.NaN)).toBe(0);
  expect(clampOffset(4000)).toBe(3000);
});

it("reads and changes one overlay's pair", () => {
  const offsets = { ...NO_OFFSETS, relicPickX: 40, relicPickY: -20 };
  expect(offsetOf(offsets, "relicPick")).toEqual({ x: 40, y: -20 });
  expect(offsetOf(offsets, "relic")).toEqual({ x: 0, y: 0 });
  expect(offsetOf(offsets, "status")).toEqual({ x: 0, y: 0 });
  expect(withOffset(offsets, "relic", { y: 5000 })).toEqual({ ...offsets, relicY: 3000 });
  expect(withOffset(offsets, "relicPick", { x: 0, y: 0 })).toEqual(NO_OFFSETS);
  expect(offsets.relicPickX).toBe(40);
});

it("takes whole numbers within the limit from an offset field", () => {
  expect(offsetDraft("120")).toBe(120);
  expect(offsetDraft(" -30 ")).toBe(-30);
  expect(offsetDraft("-")).toBeNull();
  expect(offsetDraft("")).toBeNull();
  expect(offsetDraft("12.5")).toBeNull();
  expect(offsetDraft("3001")).toBeNull();
});
