/**
 * Fixture scenarios, chosen with ?scenario=… on mock.html. Every command
 * fixture provides `default`; the other scenarios are derived here so loading,
 * empty, error and onboarding states are reproducible without a backend.
 */
export const SCENARIOS = ["default", "empty", "loading", "error", "onboarding"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function readScenario(search: string = window.location.search): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return (SCENARIOS as readonly string[]).includes(value ?? "") ? (value as Scenario) : "default";
}

export type Fixture<T, A = undefined> = {
  default: (args: A) => T;
  empty?: (args: A) => T;
  /** A fresh installation, used to exercise the full-page welcome flow. */
  onboarding?: (args: A) => T;
  /** Commands that write (e.g. save_settings) keep working in every scenario. */
  alwaysDefault?: boolean;
  /**
   * Commands the main window waits for before it shows anything (load_settings). They answer with `default`
   * in the loading and error scenarios, so those scenarios show the screens instead of an empty window.
   */
  essential?: boolean;
};

export function resolveFixture<T, A>(fixture: Fixture<T, A>, args: A, scenario: Scenario, command: string): Promise<T> {
  const failing = scenario === "loading" || scenario === "error";
  const effective = fixture.alwaysDefault || (fixture.essential && failing) ? "default" : scenario;
  switch (effective) {
    case "loading":
      return new Promise<T>(() => {});
    case "error":
      return Promise.reject(new Error(`mock: ${command} failed (scenario=error)`));
    case "empty":
      return Promise.resolve((fixture.empty ?? fixture.default)(args));
    case "onboarding":
      return Promise.resolve((fixture.onboarding ?? fixture.default)(args));
    case "default":
      return Promise.resolve(fixture.default(args));
  }
}
