import { describe, expect, it } from "vitest";
import { overlayStatusFrom } from "./overlayStatus";

describe("overlay status settings", () => {
  it("uses the visible four-second centred defaults", () => {
    expect(overlayStatusFrom(undefined)).toEqual({ enabled: true, durationSeconds: 4 });
  });

  it("clamps the saved duration", () => {
    expect(overlayStatusFrom({ enabled: false, durationSeconds: 30 })).toEqual({
      enabled: false,
      durationSeconds: 10,
    });
  });
});
