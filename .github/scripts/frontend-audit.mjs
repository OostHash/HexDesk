#!/usr/bin/env node
//
// Runs `pnpm audit` and honours the GHSA exceptions in
// .github/security/dependency-exceptions.txt.
//
// pnpm's own --ignore flag persists the IDs in pnpm-workspace.yaml, which a
// check must not rewrite, so the report is filtered here instead.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exceptionsFile =
  process.env.EXCEPTIONS_FILE ??
  join(root, ".github", "security", "dependency-exceptions.txt");

// Mirrors `pnpm audit --audit-level=high`.
const blocking = new Set(["high", "critical"]);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function readExceptions() {
  let text;
  try {
    text = readFileSync(exceptionsFile, "utf8");
  } catch {
    fail(`cannot read ${exceptionsFile}`);
  }

  return new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.split(/\s+/u))
      .filter((fields) => fields[0] === "ghsa")
      .map((fields) => fields[1].toUpperCase()),
  );
}

// pnpm reports advisories in npm's v6 shape. npm v7+ nests them under
// `vulnerabilities[].via`, so both are read to stay correct across pnpm
// upgrades.
function collectAdvisories(report) {
  if (report.advisories && typeof report.advisories === "object") {
    return Object.values(report.advisories);
  }

  const advisories = [];
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === "object" && via !== null) {
        advisories.push(via);
      }
    }
  }
  return advisories;
}

const exceptions = readExceptions();

// Windows resolves pnpm through a .cmd shim, which Node cannot spawn without a
// shell. The command is fixed, so no arguments are interpolated.
const isWindows = process.platform === "win32";
const audit = spawnSync(
  isWindows ? "pnpm audit --json" : "pnpm",
  isWindows ? [] : ["audit", "--json"],
  {
    cwd: root,
    encoding: "utf8",
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (audit.error) {
  fail(`cannot run pnpm audit: ${audit.error.message}`);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr ?? "");
  fail("pnpm audit did not return JSON");
}

const advisories = collectAdvisories(report);
const excepted = [];
const remaining = [];

for (const advisory of advisories) {
  const id = (advisory.github_advisory_id ?? "unknown").toUpperCase();
  if (exceptions.has(id)) {
    excepted.push({ id, advisory });
  } else {
    remaining.push({ id, advisory });
  }
}

for (const { id, advisory } of excepted) {
  console.log(`excepted: ${id} ${advisory.module_name} (${advisory.severity})`);
}

const blockingFindings = remaining.filter(({ advisory }) =>
  blocking.has(advisory.severity),
);

for (const { id, advisory } of blockingFindings) {
  const versions = (advisory.findings ?? [])
    .map((finding) => finding.version)
    .filter((version, index, all) => all.indexOf(version) === index)
    .join(", ");
  console.log(
    `vulnerable: ${id} ${advisory.module_name} ${versions} (${advisory.severity}) - ${advisory.title}`,
  );
}

const lowerFindings = remaining.filter(
  ({ advisory }) => !blocking.has(advisory.severity),
);

// The CI report (.github/scripts/ci-report/job.mjs) lists the findings by id.
if (process.env.AUDIT_RESULT_FILE) {
  const entry = ({ id, advisory }) => ({
    id,
    module: advisory.module_name,
    severity: advisory.severity,
    title: advisory.title,
  });
  writeFileSync(
    process.env.AUDIT_RESULT_FILE,
    JSON.stringify({
      blocking: blockingFindings.map(entry),
      lower: lowerFindings.map(entry),
      excepted: excepted.map(entry),
    }),
  );
}

const lowerSeverity = lowerFindings.length;
if (lowerSeverity > 0) {
  console.log(
    `${lowerSeverity} advisory/advisories below High are reported by pnpm but do not fail this check.`,
  );
}

if (blockingFindings.length > 0) {
  console.error(
    `${blockingFindings.length} High or Critical advisory/advisories remain. Fix them, or add a reviewed exception to .github/security/dependency-exceptions.txt.`,
  );
  process.exit(1);
}

console.log("No unexcepted High or Critical advisories found.");
