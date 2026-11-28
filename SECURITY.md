# Security policy

HexDesk is a Windows desktop application. This document explains how to report
a vulnerability, which automated dependency checks run, and how findings are
triaged or temporarily excepted.

## Supported versions

Security fixes are developed on the active `release/x.y` branch and ship in the
latest published release. Older releases do not receive separate fixes; update
to the latest release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

- Use the **Report a vulnerability** form on the
  [Security tab](https://github.com/OostHash/HexDesk/security/advisories/new) of
  the repository. This uses GitHub private vulnerability reporting.
- If the form is unavailable, contact the maintainer through
  [github.com/OostHash](https://github.com/OostHash).

Include the affected version, the impact, reproduction steps or a proof of
concept, and any known mitigation. Do not attach player names, save files or
other personal data from your installation.

Expect an acknowledgement within two business days. The maintainer will confirm
the severity, agree on a disclosure date and credit you in the advisory unless
you prefer to stay anonymous.

## Severity and fix targets

Severity follows the CVSS rating in the advisory, adjusted for whether the
vulnerable code is reachable in HexDesk and what an attacker can control.

| Severity | Fix or mitigate within |
| -------- | ---------------------- |
| Critical | 24 hours               |
| High     | 72 hours               |
| Moderate | 14 days                |
| Low      | 30 days                |

Critical and High findings are fixed before the next release. A release may
ship with a Moderate or Low finding only while a reviewed exception is valid.

## Dependency checks

| Check                       | When                                                                                                       | Behaviour                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dependency review           | Every pull request                                                                                         | Fails when the pull request introduces a High or Critical advisory in a runtime, development or unknown-scope dependency.                        |
| Dependency audit            | Daily at 06:17 UTC, on manual dispatch, and on pull requests that change dependency manifests or lockfiles | Runs `cargo deny check advisories` and `pnpm audit`. Scheduled and manual runs fail on High or Critical findings; pull request runs report them. |
| Dependabot alerts           | Continuous                                                                                                 | Opens alerts for advisories in the dependency graph.                                                                                             |
| Dependabot security updates | Continuous                                                                                                 | Opens pull requests that update vulnerable dependencies.                                                                                         |
| Dependabot version updates  | Weekly                                                                                                     | Opens grouped minor and patch update pull requests for Cargo and npm dependencies.                                                               |

Dependency review is the required pull request gate on protected branches.
Scheduled audits run against the default branch; dependency changes on a
`release/x.y` branch are covered by dependency review before they merge.

## Triage

1. Confirm that the advisory applies to the locked version and to code that
   ships or runs. Check whether the vulnerable path is reachable.
2. If a patched version exists, update the dependency through a normal pull
   request. Name the advisory ID in the pull request description.
3. If no patched version exists, or another dependency blocks the update, add a
   time-boxed exception (see below) and open an issue that tracks the upgrade.
4. Re-check the finding when the review date approaches, and remove the
   exception as soon as the dependency is fixed.

## Exceptions

An exception is a reviewed decision to accept a known advisory for a limited
time. It is not a way to make a failing check disappear.

- Entries live in `.github/security/dependency-exceptions.txt`.
- Every entry needs an advisory ID, an owner (the GitHub user or team
  accountable for the follow-up), a review date, and a reason that names the
  blocker and the upgrade path.
- Use `ghsa` entries for dependency review and for the frontend audit, and
  `cargo` entries for the Rust audit. When an advisory has both identifiers, add
  both lines so every check honours the exception.
- The review date is the last day the exception is valid. The validation step
  fails the day after, so the entry must be renewed or removed before then.
- Renewing means re-checking the advisory, confirming the blocker still exists,
  moving the review date, and linking the tracking issue. Do not renew an
  exception without a new review.
- The maintainer approves exception changes in the pull request that adds or
  renews them.
- Remove the entry as soon as a patched version is in use.

Validate the file locally with:

```bash
bash .github/scripts/dependency-exceptions.sh check
```

List the IDs that the checks currently ignore with:

```bash
bash .github/scripts/dependency-exceptions.sh list cargo
bash .github/scripts/dependency-exceptions.sh list ghsa
```

## Tool limitations

- Dependency review only inspects dependencies changed by the pull request and
  uses the GitHub Advisory Database. It does not replace a full scan.
- The Rust audit runs `cargo deny check advisories` against the RustSec
  Advisory Database and `Cargo.lock`. It only looks at crates that are built for
  the targets listed under `[graph] targets` in `deny.toml`, which are the
  targets HexDesk ships (today `x86_64-pc-windows-msvc`). Crates that exist only
  for other platforms are not reported. Adding a target to that list audits its
  dependencies too.
- The Rust audit fails on vulnerabilities and reports unmaintained, unsound and
  yanked crates as warnings. Those warnings are reviewed during dependency
  updates but do not fail the audit.
- `pnpm audit` uses the npm registry advisory endpoint and `pnpm-lock.yaml`. It
  does not inspect bundled binaries or code that is not declared as a
  dependency. The frontend audit applies the GHSA exceptions itself because
  `pnpm audit --ignore` would write the IDs into `pnpm-workspace.yaml`.
- The checks do not cover the Windows toolchain, Tauri sidecars, the WebView2
  runtime, or operating-system packages.
