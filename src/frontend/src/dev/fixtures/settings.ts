import type { Fixture } from "./scenario";

/**
 * In-memory settings file for mock mode, merged like the backend does.
 * Survives reloads of the page via sessionStorage so you can test persistence.
 */
const STORAGE_KEY = "ff-mock-settings";

const INITIAL: Record<string, unknown> = {
  timerFavorites: ["cetus-cycle", "duviri-cycle"],
  fissureWatches: [{ id: "w1", tier: "Lith", missionType: "Capture", variant: "any" }],
  fissureNotifications: true,
  // The fixture changelog is dated before the page loads; a fixed window keeps it "recent".
  recentWindow: "day",
};

function read(): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : { ...INITIAL };
  } catch {
    return { ...INITIAL };
  }
}

export function resetMockSettings() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export const loadSettings: Fixture<string> = {
  default: () => JSON.stringify(read()),
  empty: () => "",
  onboarding: () =>
    JSON.stringify({
      ...read(),
      onboardingCompleted: false,
      testingEnabled: false,
      logRetentionDays: 1,
      feedbackFrequency: "every-flow",
    }),
};

export const saveSettings: Fixture<null, { json: string }> = {
  alwaysDefault: true,
  default: ({ json }) => {
    const patch = JSON.parse(json) as Record<string, unknown>;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
    return null;
  },
};

export const setOcrModels: Fixture<null, { enabled: boolean }> = {
  alwaysDefault: true,
  default: ({ enabled }) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ocrModels: enabled }));
    return null;
  },
};
