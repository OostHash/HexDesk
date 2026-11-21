/**
 * Opt-in testing and log retention. The stored values must match `FeedbackFrequency` and the retention range in
 * `src/backend/crates/persist/src/settings.rs`; a backend test reads this file to check that.
 */
export const LOG_RETENTION_DAYS = [1, 2, 3, 4, 5] as const;
export type LogRetentionDays = (typeof LOG_RETENTION_DAYS)[number];

export type FeedbackFrequency = "every-flow" | "every-3-flows" | "every-5-flows" | "once-per-run";

export const FEEDBACK_FREQUENCIES: ReadonlyArray<{ value: FeedbackFrequency; label: string }> = [
  { value: "every-flow", label: "Every completed screen flow" },
  { value: "every-3-flows", label: "Every 3 completed screen flows" },
  { value: "every-5-flows", label: "Every 5 completed screen flows" },
  { value: "once-per-run", label: "Once per run" },
];

/** A screen flow the testing prompt asks about. */
export type FlowKind = "reward" | "refinement" | "riven";

/** How the testing prompt names a flow. */
export const FLOW_LABEL: Readonly<Record<FlowKind, string>> = {
  reward: "Relic flow",
  refinement: "Refinement",
  riven: "Riven",
};

export function logRetentionDaysFrom(value: unknown): LogRetentionDays {
  return typeof value === "number" && LOG_RETENTION_DAYS.includes(value as LogRetentionDays) ? (value as LogRetentionDays) : 1;
}

export function retentionLabel(days: LogRetentionDays): string {
  return days === 1 ? "1 day" : `${String(days)} days`;
}

export function feedbackFrequencyFrom(value: unknown): FeedbackFrequency {
  return FEEDBACK_FREQUENCIES.some((choice) => choice.value === value) ? (value as FeedbackFrequency) : "every-flow";
}
