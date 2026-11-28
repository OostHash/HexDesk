# Contributing to HexDesk

Thanks for your interest in HexDesk. This document describes how work is
planned, developed, reviewed and released. Everything in the repository and on
GitHub — code, comments, commits, issues, pull requests and docs — is written
in English.

*Still figuring out what works, maybe some parts are overkill. But with AI better 
safe then sorry*

## Setting up

Requirements (versions are pinned in the repository):

- Windows 10 or 11 (x64)
- Node.js 24 (see `.node-version`) and pnpm 11.25.0
- Rust 1.97.0 with the MSVC toolchain (see `rust-toolchain.toml`)
- The [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for
  Windows

```bash
pnpm install
pnpm --filter @hexdesk/frontend exec playwright install chromium
pnpm desktop:dev
```

`pnpm dev` runs only the frontend in a browser, which is quicker for UI work.

## Project layout

- `src/backend` — Rust crate and Tauri application.
- `src/frontend` — React + TypeScript UI (Vite, Vitest, Playwright).
- `.github/workflows` — CI checks and the release workflow.

## Planning

- Work is tracked in GitHub issues. Every change starts with an issue; use the
  bug report or feature request template and assign the appropriate issue type.
- The `Target Version` project field records the release an issue is planned
  for (`1.1`, `1.2`, …). New and unplanned work defaults to `Unscheduled`.
- Issues carry an `area:` label for the part of the app they touch.
- The [HexDesk Roadmap](https://github.com/users/OostHash/projects/2) project
  shows progress with the statuses Backlog, Ready, In progress and Done. Its
  Release Roadmap groups work by `Target Version`; the Bug Tracker shows open
  issues with the Bug issue type.
- Versions are large minor releases (1.1, 1.2, …) without deadlines. A version
  is released when the planned work for its `Target Version` is done.

## Branches

| Branch           | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `master`         | Released code only. Every commit here is a released version. |
| `release/x.y`    | Development of the next minor version. One at a time.      |
| `hotfix/x.y.z`   | Urgent patch on top of a release, branched from `master`.  |
| `feat/…`, `fix/…`| Short-lived topic branches for an issue or a group of related issues. |

- Topic branches start from the active `release/x.y` branch and are merged
  back into it through a pull request.
- A hotfix branches from `master`, is released, merged into `master`, and then
  `master` is merged into the active `release/x.y` branch so the fix is not
  lost.
- Name topic branches after the issue: `feat/12-collapsible-navigation`,
  `fix/31-stale-prices`.
- Related issues that build on each other may share one topic branch and one
  pull request that closes all of them (`Closes #1, #2, #3`). Name the branch
  after the shared topic, for example `feat/diagnostics`. Supporting work that
  the issues need does not get its own issue; describe it in the pull request.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with a short,
lower-case, imperative subject:

```
fix: read prices from the HexDeskPricing mirror

Closes #31
```

Types in use: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `ci`,
`chore`. Keep each commit focused on one change.

## Pull requests

For a feature or fix pull request targeting `release/x.y`, link its issue in
GitHub's Development sidebar instead of using a closing keyword. This keeps the
issue open while the change is tested as part of the release and lets the
project workflows move linked work to In progress. Confirm that the issue has
the correct `Target Version`.

The final `release/x.y` pull request targeting `master` lists every delivered
issue with `Closes #…`. GitHub then closes those issues when the release reaches
`master`, not when an individual change first reaches the release branch.

Before opening a pull request:

- [ ] It is linked to the relevant issue and targets the right branch. A
      release pull request to `master` contains the required `Closes #…`
      references.
- [ ] For code changes, `pnpm check` passes locally (format, lint, typecheck,
      all tests, `cargo fmt --check`, `cargo check`, `cargo clippy`).
      Documentation-only pull requests retain the required CI checks but skip
      the heavy test suites.
- [ ] Behaviour changes have tests; UI changes were checked in the running
      app, with screenshots in the PR when the look changed.
- [ ] User-visible changes have an entry under `## [Unreleased]` in
      `CHANGELOG.md`.
- [ ] No secrets, tokens, logs with player names, or `.hexdesk-dev/` data are
      included.

Pull requests are merged by the maintainer once CI is green and the review is
done.

## Security

- Report vulnerabilities privately as described in `SECURITY.md`; never open a
  public issue for one.
- Dependency review checks every pull request for newly introduced advisories,
  and a daily audit scans the locked dependencies. Keep a pull request that
  changes dependencies focused on that change so the reports stay readable.
- Accept a known advisory only through a time-boxed entry in
  `.github/security/dependency-exceptions.txt`, and validate it with
  `bash .github/scripts/dependency-exceptions.sh check`.

## Code style

- Formatting is automatic: run `pnpm format` (Prettier and `cargo fmt`).
  Settings live in `.editorconfig`, the Prettier config and `rustfmt.toml`.
- ESLint must pass with no warnings ignored without a comment explaining why.
- Clippy runs with its default lints and `-D warnings`, so every warning fails
  the check. Allow a lint only on the item that needs it, with a comment
  explaining why.
- Do not add, remove or upgrade dependencies, or change the pinned toolchain,
  in an unrelated pull request.

### Comments

Comments are read by people who only have the code, so they describe the
code as it is, in this repository.

- Explain why: a rule, a constraint, a workaround or a choice that is not
  obvious. Do not restate what the code plainly does.
- Describe the present. History such as "used to", "the old version" or
  "replaces X" belongs in the commit message and the changelog.
- Only reference what a reader can open: paths in this repository, written
  from the root (`src/backend/src/wfm.rs`), or public external sources that
  explain a rule. No private notes or documents.
- Issue numbers only for HexDesk issues (`#12`), and only when the comment
  needs the issue to make sense.
- Name other products only where the code is about them (warframe.market,
  WFCD, relics.run).
- No commented-out code, and no `TODO` or `FIXME` without an issue number.
- When code changes, update or remove the comments that describe it in the
  same change.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Write entries for users: what changed for them, not how the code changed.

## Releasing

Releases are made by the maintainer.

1. Make sure the planned work for the `Target Version` is complete and the
   release branch is green.
2. Set the new version once in `[workspace.package]` in the root `Cargo.toml`.
   The backend crates inherit it, Tauri uses it for the app package and the
   frontend reads it from the running app.
3. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]` above it.
4. Open the release (or hotfix) pull request to `master`, include `Closes #…`
   for every delivered issue, and merge it.
5. Tag the merge commit `vx.y.z` and push the tag. The release workflow checks
   that the tag matches the app version, runs `pnpm check`, and builds a signed
   draft release.
6. Review the draft release on GitHub and publish it.
7. Create the next `release/x.y` branch and move newly planned work from
   `Unscheduled` to the appropriate `Target Version`.

## License

By contributing you agree that your contributions are licensed under the
project's license (see `LICENSE`).
