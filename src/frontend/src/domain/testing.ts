export const LOG_RETENTION_DAYS = [1, 2, 3, 4, 5] as const;

export type FeedbackFrequency = "every-flow" | "every-3-flows" | "every-5-flows" | "once-per-run";

export const FEEDBACK_FREQUENCIES: ReadonlyArray<{ value: FeedbackFrequency; label: string }> = [
  { value: "every-flow", label: "Every completed screen flow" },
  { value: "every-3-flows", label: "Every 3 completed screen flows" },
  { value: "every-5-flows", label: "Every 5 completed screen flows" },
  { value: "once-per-run", label: "Once per run" },
];

export function logRetentionDaysFrom(value: unknown): (typeof LOG_RETENTION_DAYS)[number] {
  return typeof value === "number" && LOG_RETENTION_DAYS.includes(value as (typeof LOG_RETENTION_DAYS)[number])
    ? (value as (typeof LOG_RETENTION_DAYS)[number])
    : 1;
}

export function feedbackFrequencyFrom(value: unknown): FeedbackFrequency {
  return FEEDBACK_FREQUENCIES.some((choice) => choice.value === value) ? (value as FeedbackFrequency) : "every-flow";
}
