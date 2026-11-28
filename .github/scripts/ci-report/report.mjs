// Builds and renders the CI reports.
//
// Every job writes a small JSON report (see job.mjs). The same JSON is
// rendered into the job summary and, by pull-request.mjs, into one comment on
// the pull request. Reports from pull request runs are untrusted input for the
// comment, so they hold plain data only and all text is escaped on rendering.

export const REPORT_VERSION = 1;

const OUTCOMES = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "info",
  "",
]);
const MAX_TEXT = 300;
const MAX_ITEMS = 50;
const MAX_STEPS = 30;

/** Shortens and flattens text so it fits one table cell or list line. */
export function clean(value) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/**
 * Escapes text for Markdown. Pipes would break tables, angle brackets would
 * allow HTML, and an @ would notify people from text a pull request controls.
 */
export function escapeMarkdown(value) {
  return clean(value)
    .replace(/[\\`*_[\]|#]/gu, (char) => `\\${char}`)
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/@/gu, "@​");
}

/** Returns the public page of a RustSec or GitHub advisory id, or null. */
export function advisoryUrl(id) {
  if (/^RUSTSEC-\d{4}-\d{4}$/u.test(id)) {
    return `https://rustsec.org/advisories/${id}`;
  }
  if (/^GHSA(-[0-9a-z]{4}){3}$/iu.test(id)) {
    return `https://github.com/advisories/${id}`;
  }
  return null;
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

/** Sums the `test result:` lines that `cargo test` prints per test binary. */
export function parseCargoTestLog(text) {
  const totals = { passed: 0, failed: 0, ignored: 0, binaries: 0 };
  const pattern =
    /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;/gmu;
  for (const match of text.matchAll(pattern)) {
    totals.passed += Number(match[1]);
    totals.failed += Number(match[2]);
    totals.ignored += Number(match[3]);
    totals.binaries += 1;
  }
  if (totals.binaries === 0) {
    return { detail: "No test results found in the output" };
  }
  return {
    detail: `${totals.passed} passed, ${totals.failed} failed, ${totals.ignored} ignored`,
  };
}

/** Reads the totals of the Vitest JSON reporter. */
export function parseVitestJson(report) {
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  return {
    detail: `${report.numPassedTests ?? 0} passed, ${report.numFailedTests ?? 0} failed, ${skipped} skipped`,
  };
}

/** Reads the JSON lines that `cargo deny --format json` writes to stderr. */
export function parseCargoDenyJson(text) {
  const items = [];
  let counts = null;
  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith("{")) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "summary") {
      counts = entry.fields?.advisories ?? null;
    } else if (entry.type === "diagnostic" && entry.fields?.advisory) {
      const { advisory, code, severity } = entry.fields;
      if (severity === "note" || severity === "help") {
        continue;
      }
      const version = entry.fields.graphs?.[0]?.Krate?.version;
      items.push({
        id: advisory.id,
        package: version ? `${advisory.package} ${version}` : advisory.package,
        kind: code,
        level: severity,
        title: advisory.title,
      });
    }
  }
  if (counts === null) {
    return { detail: "cargo deny returned no summary", items };
  }
  return {
    detail: `${plural(counts.errors, "error")}, ${plural(counts.warnings, "warning")}`,
    items,
  };
}

/** Reads the result file that .github/scripts/frontend-audit.mjs writes. */
export function parsePnpmAudit(result) {
  const items = [
    ...result.blocking.map((entry) => ({ ...entry, level: "error" })),
    ...result.lower.map((entry) => ({ ...entry, level: "warning" })),
  ].map((entry) => ({
    id: entry.id,
    package: entry.module,
    kind: entry.severity,
    level: entry.level,
    title: entry.title,
  }));
  return {
    detail: `${plural(result.blocking.length, "High or Critical advisory", "High or Critical advisories")}, ${result.lower.length} below High, ${result.excepted.length} allowed by exception`,
    items,
  };
}

/** Reads the `vulnerable-changes` output of the dependency review action. */
export function parseDependencyReview(changes) {
  const items = [];
  for (const change of changes) {
    for (const vulnerability of change.vulnerabilities ?? []) {
      items.push({
        id: vulnerability.advisory_ghsa_id,
        package: `${change.name} ${change.version}`,
        kind: vulnerability.severity,
        level: "error",
        title: vulnerability.advisory_summary,
      });
    }
  }
  return {
    detail: `${plural(items.length, "advisory", "advisories")} in dependencies this pull request adds or changes`,
    items,
  };
}

/** Lists the entries of .github/security/dependency-exceptions.txt for one kind. */
export function parseExceptions(text, kind) {
  const items = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split(/\s+/u))
    .filter((fields) => fields[0] === kind)
    .map(([, id, owner, reviewBy, ...reason]) => ({
      id,
      package: "",
      kind: `review by ${reviewBy}, ${owner}`,
      level: "info",
      title: reason.join(" "),
    }));
  return {
    detail: items.length === 0 ? "None" : plural(items.length, "exception"),
    items,
  };
}

/**
 * Checks a report read from an artifact and keeps only the known fields, so
 * the comment never renders anything a report was not meant to contain.
 */
export function sanitizeReport(input) {
  if (
    !input ||
    input.version !== REPORT_VERSION ||
    !Array.isArray(input.steps)
  ) {
    return null;
  }
  const item = (entry) => ({
    id: clean(entry?.id),
    package: clean(entry?.package),
    kind: clean(entry?.kind),
    level: ["error", "warning", "info"].includes(entry?.level)
      ? entry.level
      : "info",
    title: clean(entry?.title),
  });
  return {
    version: REPORT_VERSION,
    job: clean(input.job),
    skipped: input.skipped ? clean(input.skipped) : "",
    steps: input.steps.slice(0, MAX_STEPS).map((step) => ({
      name: clean(step?.name),
      outcome: OUTCOMES.has(step?.outcome) ? step.outcome : "",
      reportOnly: step?.reportOnly === true,
      detail: clean(step?.detail),
      items: Array.isArray(step?.items)
        ? step.items.slice(0, MAX_ITEMS).map(item)
        : [],
    })),
  };
}

function describeOutcome(step) {
  switch (step.outcome) {
    case "success":
      return "Passed";
    case "failure":
      return step.reportOnly
        ? "Found problems (reported only, does not fail pull requests)"
        : "Failed";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Not run: an earlier step failed";
    case "info":
      return "";
    default:
      return "Not run";
  }
}

function renderItem(entry) {
  const url = advisoryUrl(entry.id);
  const id = url ? `[${entry.id}](${url})` : escapeMarkdown(entry.id);
  const parts = [
    entry.package && `\`${clean(entry.package).replace(/`/gu, "")}\``,
    entry.kind && escapeMarkdown(entry.kind),
  ]
    .filter(Boolean)
    .join(", ");
  const title = entry.title ? `: ${escapeMarkdown(entry.title)}` : "";
  return `- ${id}${parts ? ` (${parts})` : ""}${title}`;
}

/** Renders one job report as Markdown, starting with a heading of `level`. */
export function renderReport(report, level = 3) {
  const heading = `${"#".repeat(level)} ${escapeMarkdown(report.job)}`;
  if (report.skipped) {
    return `${heading}\n\nSkipped: ${escapeMarkdown(report.skipped)}\n`;
  }

  const lines = [heading, "", "| Step | Result |", "| --- | --- |"];
  const lists = [];
  for (const step of report.steps) {
    const result = [describeOutcome(step), escapeMarkdown(step.detail)]
      .filter(Boolean)
      .join(": ");
    lines.push(`| ${escapeMarkdown(step.name)} | ${result || "-"} |`);
    if (step.items.length > 0) {
      lists.push(
        "",
        `**${escapeMarkdown(step.name)}**`,
        "",
        ...step.items.map(renderItem),
      );
    }
  }
  return `${[...lines, ...lists].join("\n")}\n`;
}
