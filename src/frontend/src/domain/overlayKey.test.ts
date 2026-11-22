import { describe, expect, it } from "vitest";
import { keyFromCode, keyLabel, overlayKeyCode, overlayKeyFrom, testingKeysFrom } from "./overlayKey";

describe("overlay key", () => {
  it("is Home when nothing or something unknown is saved", () => {
    expect(overlayKeyFrom(undefined)).toBe("Home");
    expect(overlayKeyFrom("Ctrl+Q")).toBe("Home");
  });

  it("keeps a saved key, including none", () => {
    expect(overlayKeyFrom("F8")).toBe("F8");
    expect(overlayKeyFrom("off")).toBe("off");
  });

  it("maps keys to Windows virtual-key codes", () => {
    expect(overlayKeyCode("Home")).toBe(0x24);
    expect(overlayKeyCode("F1")).toBe(0x70);
    expect(overlayKeyCode("F12")).toBe(0x7b);
    expect(overlayKeyCode("ScrollLock")).toBe(0x91);
    expect(overlayKeyCode("off")).toBe(0);
    expect(overlayKeyCode("KeyQ")).toBe(0x51);
    expect(overlayKeyCode("Digit5")).toBe(0x35);
    expect(overlayKeyCode("Numpad0")).toBe(0x60);
  });

  it("takes key presses by their code and refuses keys the game or the capture needs", () => {
    expect(keyFromCode("KeyQ")?.label).toBe("Q");
    expect(keyFromCode("F13")?.vk).toBe(0x7c);
    for (const code of ["Escape", "Enter", "Space", "Tab", "ShiftLeft", "Semicolon"]) expect(keyFromCode(code)).toBeUndefined();
  });

  it("names keys for the screen", () => {
    expect(keyLabel("PageUp")).toBe("Page Up");
    expect(keyLabel("off")).toBe("None");
  });
});

describe("testing keys", () => {
  it("are Page Up and Page Down unless other keys are saved", () => {
    const defaults = { correct: "PageUp", wrong: "PageDown" };
    expect(testingKeysFrom(undefined, undefined)).toEqual(defaults);
    expect(testingKeysFrom("F1", "F1")).toEqual(defaults);
    expect(testingKeysFrom("Ctrl+Q", "F2")).toEqual({ correct: "PageUp", wrong: "F2" });
    expect(testingKeysFrom("F1", "F2")).toEqual({ correct: "F1", wrong: "F2" });
  });

  it("keep a removed key removed", () => {
    expect(testingKeysFrom("off", "F2")).toEqual({ correct: "off", wrong: "F2" });
    expect(testingKeysFrom("off", "off")).toEqual({ correct: "off", wrong: "off" });
  });
});
