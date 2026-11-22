/** Overlay key and testing key rules. Pure functions. */

/**
 * A key HexDesk can listen for. The id is the browser's `KeyboardEvent.code`, so a captured key press maps
 * straight to it, and `vk` is the Windows virtual-key code the backend's keyboard hook compares.
 */
export type KeyChoice = { id: string; label: string; vk: number };

const range = (count: number, make: (i: number) => KeyChoice): KeyChoice[] => Array.from({ length: count }, (_, i) => make(i));

/**
 * Keys that can be captured. Only keys whose virtual-key code does not depend on the keyboard layout: letters,
 * digits, function keys, the navigation block, arrows and the numpad. Modifiers, Escape, Tab, Enter and the space
 * bar are left out; they are needed for the game and for leaving the capture.
 */
export const KEY_CHOICES: readonly KeyChoice[] = [
  { id: "Home", label: "Home", vk: 0x24 },
  { id: "End", label: "End", vk: 0x23 },
  { id: "Insert", label: "Insert", vk: 0x2d },
  { id: "Delete", label: "Delete", vk: 0x2e },
  { id: "PageUp", label: "Page Up", vk: 0x21 },
  { id: "PageDown", label: "Page Down", vk: 0x22 },
  { id: "Pause", label: "Pause", vk: 0x13 },
  { id: "ScrollLock", label: "Scroll Lock", vk: 0x91 },
  { id: "ArrowLeft", label: "Left arrow", vk: 0x25 },
  { id: "ArrowUp", label: "Up arrow", vk: 0x26 },
  { id: "ArrowRight", label: "Right arrow", vk: 0x27 },
  { id: "ArrowDown", label: "Down arrow", vk: 0x28 },
  ...range(24, (i) => ({ id: `F${String(i + 1)}`, label: `F${String(i + 1)}`, vk: 0x70 + i })),
  ...range(26, (i) => {
    const letter = String.fromCharCode(0x41 + i);
    return { id: `Key${letter}`, label: letter, vk: 0x41 + i };
  }),
  ...range(10, (i) => ({ id: `Digit${String(i)}`, label: String(i), vk: 0x30 + i })),
  ...range(10, (i) => ({ id: `Numpad${String(i)}`, label: `Numpad ${String(i)}`, vk: 0x60 + i })),
  { id: "NumpadMultiply", label: "Numpad *", vk: 0x6a },
  { id: "NumpadAdd", label: "Numpad +", vk: 0x6b },
  { id: "NumpadSubtract", label: "Numpad -", vk: 0x6d },
  { id: "NumpadDecimal", label: "Numpad .", vk: 0x6e },
  { id: "NumpadDivide", label: "Numpad /", vk: 0x6f },
];

/** A stored key id: a `KEY_CHOICES` id, or "off" for no overlay key. */
export type OverlayKey = string;

export const NO_KEY: OverlayKey = "off";
export const DEFAULT_OVERLAY_KEY: OverlayKey = "Home";

const choice = (key: unknown): KeyChoice | undefined => KEY_CHOICES.find((k) => k.id === key);

/** The key a key press is, or undefined when that key cannot be used. */
export const keyFromCode = (code: string): KeyChoice | undefined => choice(code);

export const overlayKeyFrom = (v: unknown): OverlayKey => (v === NO_KEY || choice(v) ? (v as OverlayKey) : DEFAULT_OVERLAY_KEY);

/** The virtual-key code the backend listens for; 0 for none. */
export const overlayKeyCode = (key: OverlayKey): number => choice(key)?.vk ?? 0;

/** How a key is named on screen. */
export const keyLabel = (key: OverlayKey): string => (key === NO_KEY ? "None" : (choice(key)?.label ?? key));

/** The two keys that answer the testing prompt. HexDesk takes them from the game only while the prompt is visible. */
export type TestingKeys = { correct: OverlayKey; wrong: OverlayKey };

export const DEFAULT_TESTING_KEYS: TestingKeys = { correct: "PageUp", wrong: "PageDown" };

/**
 * The stored testing keys. A missing or unknown key is its default, a removed key stays "off", and the same key
 * twice gives both defaults.
 */
export function testingKeysFrom(correct: unknown, wrong: unknown): TestingKeys {
  const stored = (v: unknown, fallback: OverlayKey): OverlayKey => (v === NO_KEY || choice(v) ? (v as OverlayKey) : fallback);
  const keys = { correct: stored(correct, DEFAULT_TESTING_KEYS.correct), wrong: stored(wrong, DEFAULT_TESTING_KEYS.wrong) };
  return keys.correct !== NO_KEY && keys.correct === keys.wrong ? DEFAULT_TESTING_KEYS : keys;
}

/** Whether both testing keys are set; without them HexDesk asks nothing. */
export const testingKeysSet = (keys: TestingKeys): boolean => keys.correct !== NO_KEY && keys.wrong !== NO_KEY;
