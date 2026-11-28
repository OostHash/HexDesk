#!/usr/bin/env node
//
// Writes the report of one CI job: report.json for the pull request comment
// (.github/scripts/ci-report/pull-request.mjs) and the same content as Markdown
// in the job summary.
//
// Input comes from the environment, set by the workflow:
//   REPORT_JOB      job name as shown in the report
//   REPORT_SKIPPED  reason the job skipped its checks, empty when they ran
//   REPORT_STEPS    JSON array of { name, outcome, reportOnly?, source? }
//   REPORT_DIR      output directory (default: $RUNNER_TEMP/ci-report)
//
// A source adds the result of a tool to its step. `file` is relative to
// $RUNNER_TEMP, so the JSON holds no Windows paths with backslashes:
//   { "kind": "vitest", "file": "..." }        Vitest JSON reporter output
//   { "kind": "cargo-test", "file": "..." }    captured `cargo test` output
//   { "kind": "cargo-deny", "file": "..." }    `cargo deny --format json` stderr
//   { "kind": "pnpm-audit", "file": "..." }    frontend-audit.mjs result file
//   { "kind": "dependency-review", "env": "NAME" }  vulnerable-changes output
//   { "kind": "exceptions", "type": "cargo" | "ghsa" }

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPORT_VERSION,
  parseCargoDenyJson,
  parseCargoTestLog,
  parseDependencyReview,
  parseExceptions,
  parsePnpmAudit,
  parseVitestJson,
  renderReport,
  sanitizeReport,
} from "./report.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readSource(source) {
  const read = () =>
    readFileSync(join(process.env.RUNNER_TEMP ?? ".", source.file), "utf8");
  switch (source.kind) {
    case "vitest":
      return parseVitestJson(JSON.parse(read()));
    case "cargo-test":
      return parseCargoTestLog(read());
    case "cargo-deny":
      return parseCargoDenyJson(read());
    case "pnpm-audit":
      return parsePnpmAudit(JSON.parse(read()));
    case "dependency-review":
      return parseDependencyReview(JSON.parse(process.env[source.env] || "[]"));
    case "exceptions":
      return parseExceptions(
        readFileSync(
          join(root, ".github", "security", "dependency-exceptions.txt"),
          "utf8",
        ),
        source.type,
      );
    default:
      throw new Error(`unknown source kind '${source.kind}'`);
  }
}

function buildStep(spec) {
  const step = {
    name: spec.name,
    outcome: spec.outcome,
    reportOnly: spec.reportOnly === true,
    detail: "",
    items: [],
  };
  // A step that did not run has no result to read.
  if (
    spec.source &&
    (spec.outcome === "success" ||
      spec.outcome === "failure" ||
      spec.outcome === "info")
  ) {
    try {
      Object.assign(step, readSource(spec.source));
    } catch (error) {
      step.detail = `Result could not be read (${error.message})`;
    }
  }
  return step;
}

export function buildReport(env) {
  const skipped = env.REPORT_SKIPPED ?? "";
  return sanitizeReport({
    version: REPORT_VERSION,
    job: env.REPORT_JOB ?? "Job",
    skipped,
    steps: skipped ? [] : JSON.parse(env.REPORT_STEPS || "[]").map(buildStep),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildReport(process.env);
  const dir =
    process.env.REPORT_DIR || join(process.env.RUNNER_TEMP ?? ".", "ci-report");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const markdown = renderReport(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  process.stdout.write(markdown);
}
