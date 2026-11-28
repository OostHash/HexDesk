#!/usr/bin/env node
//
// Writes one comment on a pull request that combines the reports of every
// check that ran for its latest commit. Run by .github/workflows/ci-report.yml
// after each of the reported workflows completes; every run rebuilds the whole
// comment from the GitHub API, so the order in which workflows finish does not
// matter.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, HEAD_SHA, and optionally
// GITHUB_API_URL. With DRY_RUN set, the comment is printed instead of posted.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clean,
  escapeMarkdown,
  renderReport,
  sanitizeReport,
} from "./report.mjs";

export const MARKER = "<!-- hexdesk-ci-report -->";

// The workflows that write reports, in the order the comment shows them. The
// note explains a missing run, so a check that did not run is not mistaken for
// one that passed.
export const WORKFLOWS = [
  { name: "CI", missing: "No run found for this commit." },
  {
    name: "Dependency audit",
    missing:
      "Did not run: it runs only when dependency manifests, lockfiles or audit settings change.",
  },
  { name: "Dependency review", missing: "No run found for this commit." },
];

// The comment limit is 65536 characters. Reports are cut well before that.
const MAX_BODY = 60000;
const MAX_ARTIFACT_BYTES = 256 * 1024;

const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
const repo = process.env.GITHUB_REPOSITORY;

async function request(method, path, body) {
  const response = await fetch(
    path.startsWith("http") ? path : `${api}${path}`,
    {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}`);
  }
  return response;
}

async function getAll(path, key) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await (
      await request("GET", `${path}${separator}per_page=100&page=${page}`)
    ).json();
    const batch = key ? data[key] : data;
    items.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return items;
}

/** Describes a run or job by its status and conclusion, in plain words. */
export function describeConclusion(status, conclusion) {
  if (status !== "completed") {
    return "Running";
  }
  switch (conclusion) {
    case "success":
      return "Passed";
    case "failure":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "timed_out":
      return "Timed out";
    case "neutral":
      return "Neutral";
    default:
      return clean(conclusion) || "Unknown";
  }
}

/**
 * Keeps the newest run of each workflow name. Run ids grow over time, and the
 * API already returns the latest attempt of a run.
 */
export function latestRuns(runs) {
  const latest = new Map();
  for (const run of runs) {
    const current = latest.get(run.name);
    if (!current || run.id > current.id) {
      latest.set(run.name, run);
    }
  }
  return latest;
}

/**
 * Builds the comment body.
 *
 * `runs` maps each workflow name to { run, jobs, reports }, where `reports`
 * maps a job name to its sanitized report. `codeql` is a list of check runs.
 */
export function renderComment({ sha, runs, codeql }) {
  const overview = ["| Check | Result |", "| --- | --- |"];
  const sections = [];

  for (const workflow of WORKFLOWS) {
    const entry = runs.get(workflow.name);
    if (!entry) {
      overview.push(`| ${workflow.name} | ${workflow.missing} |`);
      continue;
    }
    const { run, jobs, reports } = entry;
    const result = describeConclusion(run.status, run.conclusion);
    overview.push(`| [${workflow.name}](${run.html_url}) | ${result} |`);

    const parts = [`## ${workflow.name}`, ""];
    for (const job of jobs) {
      const report = reports.get(job.name);
      if (report) {
        parts.push(renderReport(report, 3));
      } else {
        parts.push(
          `### ${escapeMarkdown(job.name)}`,
          "",
          `${describeConclusion(job.status, job.conclusion)}. This job writes no report.`,
          "",
        );
      }
    }
    sections.push(parts.join("\n"));
  }

  if (codeql.length === 0) {
    overview.push("| CodeQL | No analysis found for this commit. |");
  } else {
    const failed = codeql.filter(
      (check) =>
        check.status === "completed" &&
        check.conclusion !== "success" &&
        check.conclusion !== "neutral" &&
        check.conclusion !== "skipped",
    );
    const running = codeql.filter((check) => check.status !== "completed");
    const result =
      running.length > 0 ? "Running" : failed.length > 0 ? "Failed" : "Passed";
    overview.push(
      `| CodeQL | ${result} (${codeql.map((check) => escapeMarkdown(check.name)).join(", ")}) |`,
    );
  }

  let body = [
    MARKER,
    "# CI report",
    "",
    `For commit ${sha.slice(0, 7)}.`,
    "",
    ...overview,
    "",
    ...sections,
  ].join("\n");
  if (body.length > MAX_BODY) {
    body = `${body.slice(0, MAX_BODY)}\n\nThe report was cut to fit a comment. The job summaries of each run have the full text.\n`;
  }
  return body;
}

function unzipReport(buffer) {
  const dir = mkdtempSync(join(tmpdir(), "ci-report-"));
  const zip = join(dir, "report.zip");
  writeFileSync(zip, buffer);
  const result = spawnSync("unzip", ["-p", zip, "report.json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  try {
    return sanitizeReport(JSON.parse(result.stdout));
  } catch {
    return null;
  }
}

async function readReports(run) {
  const reports = new Map();
  const artifacts = await getAll(
    `/repos/${repo}/actions/runs/${run.id}/artifacts`,
    "artifacts",
  );
  for (const artifact of artifacts) {
    if (
      !artifact.name.startsWith("ci-report-") ||
      artifact.expired ||
      artifact.size_in_bytes > MAX_ARTIFACT_BYTES
    ) {
      continue;
    }
    const response = await request("GET", artifact.archive_download_url);
    const report = unzipReport(Buffer.from(await response.arrayBuffer()));
    if (report) {
      reports.set(report.job, report);
    }
  }
  return reports;
}

async function main() {
  const sha = process.env.HEAD_SHA;
  if (!/^[0-9a-f]{40}$/u.test(sha ?? "")) {
    throw new Error("HEAD_SHA must be a full commit SHA");
  }

  // Looked up by head commit, which also finds pull requests from forks. A
  // commit that is no longer the head of an open pull request gets no comment,
  // so a late run for an older push cannot overwrite a newer report.
  const pulls = await getAll(`/repos/${repo}/pulls?state=open`);
  const pull = pulls.find((candidate) => candidate.head.sha === sha);
  if (!pull && !process.env.DRY_RUN) {
    console.log(`No open pull request has ${sha} as its head commit.`);
    return;
  }

  const allRuns = await getAll(
    `/repos/${repo}/actions/runs?head_sha=${sha}&event=pull_request`,
    "workflow_runs",
  );
  const names = new Set(WORKFLOWS.map((workflow) => workflow.name));
  const runs = new Map();
  for (const [name, run] of latestRuns(
    allRuns.filter((run) => names.has(run.name)),
  )) {
    const jobs = await getAll(
      `/repos/${repo}/actions/runs/${run.id}/jobs`,
      "jobs",
    );
    const reports =
      run.status === "completed" ? await readReports(run) : new Map();
    runs.set(name, { run, jobs, reports });
  }

  const checks = await getAll(
    `/repos/${repo}/commits/${sha}/check-runs`,
    "check_runs",
  );
  const codeql = checks.filter(
    (check) => check.name === "CodeQL" || check.name.startsWith("Analyze ("),
  );

  const body = renderComment({ sha, runs, codeql });
  if (process.env.DRY_RUN) {
    console.log(body);
    return;
  }
  const comments = await getAll(
    `/repos/${repo}/issues/${pull.number}/comments`,
  );
  const existing = comments.find(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.startsWith(MARKER),
  );
  if (existing) {
    await request("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, {
      body,
    });
    console.log(`Updated the report on pull request #${pull.number}.`);
  } else {
    await request("POST", `/repos/${repo}/issues/${pull.number}/comments`, {
      body,
    });
    console.log(`Added a report to pull request #${pull.number}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
