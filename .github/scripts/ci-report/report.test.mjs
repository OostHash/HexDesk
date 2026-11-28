// Run with: node --test ".github/scripts/ci-report/*.test.mjs"

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advisoryUrl,
  escapeMarkdown,
  parseCargoDenyJson,
  parseCargoTestLog,
  parseDependencyReview,
  parseExceptions,
  parsePnpmAudit,
  parseVitestJson,
  renderReport,
  sanitizeReport,
} from "./report.mjs";
import { latestRuns, MARKER, renderComment } from "./pull-request.mjs";

test("cargo test totals add up every test binary", () => {
  const log = [
    "running 3 tests",
    "test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s",
    "test result: FAILED. 10 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s",
  ].join("\n");
  assert.equal(parseCargoTestLog(log).detail, "13 passed, 2 failed, 1 ignored");
  assert.equal(
    parseCargoTestLog("error: could not compile").detail,
    "No test results found in the output",
  );
});

test("vitest totals count pending and todo tests as skipped", () => {
  const detail = parseVitestJson({
    numPassedTests: 5,
    numFailedTests: 1,
    numPendingTests: 2,
    numTodoTests: 1,
  }).detail;
  assert.equal(detail, "5 passed, 1 failed, 3 skipped");
});

test("cargo deny diagnostics become items with their advisory id", () => {
  const lines = [
    JSON.stringify({
      type: "diagnostic",
      fields: {
        code: "unmaintained",
        severity: "warning",
        advisory: {
          id: "RUSTSEC-2026-0543",
          package: "chrono",
          title: "chrono is unmaintained",
        },
        graphs: [{ Krate: { name: "chrono", version: "0.4.45" } }],
      },
    }),
    JSON.stringify({
      type: "diagnostic",
      fields: {
        code: "advisory-ignored",
        severity: "note",
        advisory: { id: "RUSTSEC-2024-0001", package: "x" },
      },
    }),
    JSON.stringify({
      type: "summary",
      fields: { advisories: { errors: 0, warnings: 1, notes: 1, helps: 0 } },
    }),
  ].join("\n");
  const result = parseCargoDenyJson(lines);
  assert.equal(result.detail, "0 errors, 1 warning");
  assert.deepEqual(result.items, [
    {
      id: "RUSTSEC-2026-0543",
      package: "chrono 0.4.45",
      kind: "unmaintained",
      level: "warning",
      title: "chrono is unmaintained",
    },
  ]);
  assert.equal(parseCargoDenyJson("").detail, "cargo deny returned no summary");
});

test("pnpm audit result lists blocking and lower findings", () => {
  const result = parsePnpmAudit({
    blocking: [
      {
        id: "GHSA-aaaa-bbbb-cccc",
        module: "left-pad",
        severity: "high",
        title: "Bad",
      },
    ],
    lower: [
      {
        id: "GHSA-dddd-eeee-ffff",
        module: "right-pad",
        severity: "low",
        title: "Minor",
      },
    ],
    excepted: [],
  });
  assert.equal(
    result.detail,
    "1 High or Critical advisory, 1 below High, 0 allowed by exception",
  );
  assert.deepEqual(
    result.items.map((item) => [item.id, item.level]),
    [
      ["GHSA-aaaa-bbbb-cccc", "error"],
      ["GHSA-dddd-eeee-ffff", "warning"],
    ],
  );
});

test("dependency review lists each vulnerability of a changed package", () => {
  const result = parseDependencyReview([
    {
      name: "lodash",
      version: "4.17.20",
      vulnerabilities: [
        {
          advisory_ghsa_id: "GHSA-xxxx-yyyy-zzzz",
          severity: "high",
          advisory_summary: "Prototype pollution",
        },
      ],
    },
  ]);
  assert.equal(
    result.detail,
    "1 advisory in dependencies this pull request adds or changes",
  );
  assert.equal(result.items[0].package, "lodash 4.17.20");
  assert.equal(
    parseDependencyReview([]).detail,
    "0 advisories in dependencies this pull request adds or changes",
  );
});

test("exceptions are listed per kind", () => {
  const text = [
    "# comment",
    "cargo RUSTSEC-2026-0543 OostHash 2026-12-31 No maintained release yet",
    "ghsa GHSA-aaaa-bbbb-cccc OostHash 2026-12-31 Waiting for upstream",
  ].join("\n");
  const cargo = parseExceptions(text, "cargo");
  assert.equal(cargo.detail, "1 exception");
  assert.equal(cargo.items[0].kind, "review by 2026-12-31, OostHash");
  assert.equal(cargo.items[0].title, "No maintained release yet");
  assert.equal(parseExceptions("# none", "ghsa").detail, "None");
});

test("advisory links are built only for known id formats", () => {
  assert.equal(
    advisoryUrl("RUSTSEC-2026-0543"),
    "https://rustsec.org/advisories/RUSTSEC-2026-0543",
  );
  assert.equal(
    advisoryUrl("GHSA-aaaa-bbbb-cccc"),
    "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  );
  assert.equal(advisoryUrl("javascript:alert(1)"), null);
});

test("markdown from reports cannot add HTML, break tables or mention people", () => {
  const escaped = escapeMarkdown("<img src=x> | @someone [link](http://x)");
  assert.ok(!escaped.includes("<img"));
  assert.ok(!escaped.includes(" | "));
  assert.ok(!escaped.includes("@someone"));
  assert.ok(!escaped.includes("[link]"));
});

test("sanitizing drops unknown fields and unknown outcomes", () => {
  const report = sanitizeReport({
    version: 1,
    job: "Backend",
    extra: "dropped",
    steps: [
      {
        name: "Tests",
        outcome: "pwned",
        detail: "x".repeat(1000),
        items: [{ id: "A", level: "boom", url: "http://evil" }],
      },
    ],
  });
  assert.equal(report.extra, undefined);
  assert.equal(report.steps[0].outcome, "");
  assert.ok(report.steps[0].detail.length <= 300);
  assert.equal(report.steps[0].items[0].level, "info");
  assert.equal(report.steps[0].items[0].url, undefined);
  assert.equal(sanitizeReport({ version: 2, steps: [] }), null);
  assert.equal(sanitizeReport(null), null);
});

test("a job report shows one row per step and the reason for a skip", () => {
  const report = sanitizeReport({
    version: 1,
    job: "Backend",
    steps: [
      { name: "Clippy", outcome: "failure" },
      { name: "Tests", outcome: "skipped" },
      {
        name: "Audit",
        outcome: "failure",
        reportOnly: true,
        detail: "0 errors, 1 warning",
        items: [
          {
            id: "RUSTSEC-2026-0543",
            package: "chrono 0.4.45",
            kind: "unmaintained",
            level: "warning",
            title: "chrono is unmaintained",
          },
        ],
      },
    ],
  });
  const markdown = renderReport(report);
  assert.match(markdown, /\| Clippy \| Failed \|/u);
  assert.match(markdown, /\| Tests \| Not run: an earlier step failed \|/u);
  assert.match(
    markdown,
    /Found problems \(reported only, does not fail pull requests\): 0 errors, 1 warning/u,
  );
  assert.match(
    markdown,
    /- \[RUSTSEC-2026-0543\]\(https:\/\/rustsec\.org\/advisories\/RUSTSEC-2026-0543\) \(`chrono 0\.4\.45`, unmaintained\): chrono is unmaintained/u,
  );

  const skipped = renderReport(
    sanitizeReport({
      version: 1,
      job: "Frontend",
      skipped: "This pull request changes no frontend or shared files.",
      steps: [],
    }),
  );
  assert.equal(
    skipped,
    "### Frontend\n\nSkipped: This pull request changes no frontend or shared files.\n",
  );
});

test("the newest run of each workflow is kept", () => {
  const latest = latestRuns([
    { id: 10, name: "CI" },
    { id: 12, name: "CI" },
    { id: 11, name: "Dependency review" },
  ]);
  assert.equal(latest.get("CI").id, 12);
  assert.equal(latest.get("Dependency review").id, 11);
});

test("the comment explains missing runs and jobs without a report", () => {
  const ci = {
    run: {
      status: "completed",
      conclusion: "failure",
      html_url: "https://github.com/o/r/actions/runs/1",
    },
    jobs: [
      {
        name: "Detect relevant changes",
        status: "completed",
        conclusion: "success",
      },
      { name: "Backend", status: "completed", conclusion: "failure" },
    ],
    reports: new Map([
      [
        "Backend",
        sanitizeReport({
          version: 1,
          job: "Backend",
          steps: [{ name: "Clippy", outcome: "failure" }],
        }),
      ],
    ]),
  };
  const body = renderComment({
    sha: "0123456789abcdef0123456789abcdef01234567",
    runs: new Map([["CI", ci]]),
    codeql: [
      { name: "Analyze (rust)", status: "completed", conclusion: "success" },
    ],
  });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /For commit 0123456\./u);
  assert.match(
    body,
    /\| \[CI\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\) \| Failed \|/u,
  );
  assert.match(body, /\| Dependency audit \| Did not run: it runs only when/u);
  assert.match(
    body,
    /\| Dependency review \| No run found for this commit\. \|/u,
  );
  assert.match(body, /\| CodeQL \| Passed \(Analyze \(rust\)\) \|/u);
  assert.match(
    body,
    /### Detect relevant changes\n\nPassed\. This job writes no report\./u,
  );
  assert.match(body, /\| Clippy \| Failed \|/u);
});
