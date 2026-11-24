# Changelog

All notable changes to HexDesk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Updated third-party libraries to address reported security vulnerabilities in
  the database and XML parsing dependencies.
- The inventory and the changelog update right after a mission again. A scan
  that misses part of the inventory now updates everything it did read and
  keeps the rest, instead of being ignored until a complete scan comes in.

## [1.1.1] - 2026-11-22

### Fixed

- Updated third-party libraries and build tooling to address reported security
  vulnerabilities.

## [1.1.0] - 2026-11-22

### Added

- A guided welcome screen for new installations covers appearance, screen
  reading, the memory scanner, overlay controls and optional testing. Existing
  installations continue normally, and the guide can be opened again from
  Settings → General. It also links to the HexDesk Discord.
- An activity console in Settings → Console shows inventory scans, overlay
  reads, updates and errors as they happen. Entries can be filtered, opened
  for details and copied into a bug report.
- A diagnostics export creates one zip in Downloads with only the information
  you choose. HexDesk attempts to redact known passwords, tokens, e-mail
  addresses and player names; review the zip before sharing it.
- Optional screen-reading feedback, off by default, lets testers mark a relic
  reward, refinement or Riven as correct or incorrect using configurable
  keys. Incorrect reads remain available after a restart and can be exported
  or discarded from the header. Reports are saved locally only when you
  choose to export them; HexDesk never uploads them automatically and never
  captures the rest of your desktop.
- Diagnostic logs can be kept for one to five days. **Remove logs** clears
  existing logs, saved OCR captures and pending test data after confirmation,
  while logging continues for the current session.
- An overlay key opens or hides the overlay for the current game screen.
  Manual mode only reads a screen when that key is pressed, while a small
  click-through status line shows what the overlay is doing.
- Optional enhanced OCR downloads about 12 MB of models to read small relic
  counts and refinement tags that Windows OCR misses.
- Updates can be checked and installed from Settings → General.

### Changed

- Settings is now a full screen with clearer categories, a more useful General
  page and the app version and update status in one place. Overlay keys are
  assigned by pressing the key you want instead of choosing from a list.
- The navigation uses larger, screen-specific icons and can collapse to icons
  only. The modular window and changelog bars are easier to open and close,
  and the changelog shows clearer, dated inventory changes.
- "Changed recently" can cover the current HexDesk session, the last hour,
  24 hours, 7 days or the complete changelog. Item badges show how long ago a
  change happened.
- Relic Reward appears as soon as two complete reads agree, marks uncertain
  card names and keeps closely spaced rewards separate. It also reacts more
  reliably when the reward screen closes or changes.
- Relic Pick opens sooner and follows the relics actually shown on screen,
  including their counts and refinements. Small OCR mistakes and temporarily
  missing text are handled more reliably.
- The Riven check now runs in the background like the relic overlays, opening
  and closing with the Riven screen without blocking the main window.
- Logs and warframe.market errors now explain what failed. Repeated messages
  are grouped, and Windows user names and player names are no longer written
  to log files.

### Removed

- The old release-build debugging tools and separate session/debug files are
  replaced by the activity console and diagnostics export. Debug files left
  behind by earlier versions are cleaned up when HexDesk starts.

### Fixed

- The inventory and the changelog update right after a mission instead of
  being delayed by about two minutes.
- "Changed recently" defaults to the current HexDesk session instead of
  showing every recorded change.
- The main window is named HexDesk in Alt+Tab, the taskbar and Task Manager.
- Clicking an active filter preset again turns it off and, when enabled,
  restores the filters that were active before it.
- The Relic Pick overlay closes by itself again when you pick a relic, back
  out or start the mission. It no longer opens after the selection screen has
  already closed.
- Relic Reward and Relic Pick now count owned parts, blueprints, Foundry jobs,
  built items and newly received rewards consistently. Warframe-part
  blueprints no longer appear to be missing from a set.
- Disabling Relic Reward stops its background screen reads, and enabling or
  disabling the Relic Reward and Riven overlays takes effect immediately.
- The Riven overlay no longer has a second border around it.
- The mouse cursor and close button work on the Relic Pick overlay, and relic
  rewards remain available there after restarting HexDesk.

## [1.0.1] - 2026-11-17

### Fixed

- Bulk prices for relic values, relic recommendations and price lists were up
  to a month out of date, because the FrameForge pricing mirror stopped
  updating on 2026-10-14. HexDesk now reads prices and ducat exceptions from
  its own mirror, [HexDeskPricing](https://github.com/OostHash/HexDeskPricing),
  which refreshes from relics.run twice a day.

### Changed

- The licence notice now names HexDesk. A new `NOTICE` file records authorship:
  the frontend was written for HexDesk, the backend is derived from FrameForge
  4.5.0.

## [1.0.0] - 2026-11-17

### Added

- Introduced the approved HexDesk emblem as scalable SVG artwork, dark and
  light application icons, transparent black and white exports, Windows icon
  assets, and a 1280 × 640 GitHub social preview.
- A free, open-source Windows desktop companion for Warframe under the HexDesk
  identity: “The Origin System, Connected.”

### Changed

- Renamed the application from FrameForge to HexDesk throughout product
  metadata, window names, notifications, network user agents, diagnostics, and
  temporary filenames.
- HexDesk uses its own configuration, data, cache, and Windows Credential
  Manager namespaces. It no longer imports FrameForge data automatically, so
  both applications can coexist.
- The HexDesk updater uses its own release endpoint and signature
  verification key.
- Rebuilt the application shell and every main screen around one consistent,
  responsive design system with shared navigation, controls, cards, tables,
  dialogs, popovers, and loading, empty, and error states.
- Reorganized the application into clearer work areas: Foundry combines
  equipment and syndicates; Inventory contains items, Prime Sets, and Mods &
  Arcanes; Market contains trading and reports; Relics contains the collection
  and planner; and Rivens contains the analyzer and owned rivens.
- Added system, dark, and light themes; normal and high contrast; a
  colour-blind palette; three interface densities; and text scaling from 80% to
  200%.
- Standardized searching, sorting, filtering, pagination, card and list views,
  image visibility, and reusable filter presets across the catalogue screens.
- Redesigned Settings as a tabbed dialog with grouped controls for General,
  Overlays, Market, Filters, Data, and Debugging.
- Reworked the header around account, update, memory scanner, warframe.market,
  and data-cache status. Report a bug and Settings now live at the bottom of
  the main navigation.
- Rebuilt the inventory changelog as a collapsible, searchable, resizable dock
  with a live change feed, Inventory shortcuts, and an optional separate
  window.
- Reworked the Modular Window with reorderable tracking, favourites, timers,
  and fissures; docked resizing; a separate-window mode; and a persistent
  collapsed rail.
- Rebuilt the relic reward, relic pick, and riven comparison overlays and their
  settings previews to use the same visual and accessibility system as the main
  application.
- Added a custom Windows title bar with standard window controls and native
  Windows 11 Snap Layout support.
- Improved narrow-window layouts, keyboard navigation, focus visibility,
  screen-reader labels, reduced-motion behaviour, and Windows forced-colour
  support.

### Removed

- FrameForge donation and Discord links.

### Platform

- Implemented the new frontend platform with React Aria, Tailwind CSS, and
  TanStack and connected it to the Rust/Tauri backend through a shared command
  contract.
- Separated the frontend and backend into pnpm and Cargo workspace packages
  under `src/frontend` and `src/backend`.
- Added central `dev`, `build`, `check`, test, Tauri, and unsigned installer
  commands.
- Added ESLint, Prettier, Vitest browser tests, Playwright accessibility and
  visual suites, generated design tokens, EditorConfig, and rustfmt rules.
- Added Windows-aware CI and pinned Node.js, pnpm, and Rust toolchain versions.
- Moved the Kitchen sink and Tokens development pages into Settings →
  Debugging.
- Condensed the README and updated repository documentation for the new layout,
  commands, installation, provenance, and licensing.
- Removed obsolete slash-command automation and editor-specific configuration.
- A per-machine NSIS installer that installs HexDesk under `Program Files`,
  registers an uninstaller, blocks downgrades, and installs WebView2 when
  needed.
- GitHub issue forms for structured bug reports and feature requests.

## Imported baseline - FrameForge 4.5.0 (2026-11-15)

### Added

- Created the initial HexDesk source snapshot. The upstream Git history was
  not imported; the GPLv3 license and attribution were retained.
