# Changelog

All notable changes to HexDesk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A welcome screen for new installations: a welcome page, then appearance and
  optional small-text OCR, the memory scanner with what it does and its risk,
  the overlay key and manual mode, the opt-in for testing with an
  explanation of how a test report works, and a way to join the HexDesk
  Discord, with a QR code for your phone. Existing installations continue
  normally, and Settings → General can show it again.
- Diagnostic logs can be kept for one to five days, with one day as the
  default, in Settings → Console. HexDesk removes older daily log files
  automatically.
- Optional testing: after a relic reward, a refinement or a riven, a short
  prompt over the game asks whether HexDesk read the screen correctly. One
  key forgets the screen and another keeps it for a report. Both keys can be
  chosen by pressing them and default to Page Up and Page Down; without both,
  HexDesk asks nothing and says so. A bar shows how long the question stays
  up, and a short line over the game confirms each answer. Screens marked
  wrong wait in the header, next to your Mastery Rank and account name, also
  after HexDesk restarts. From there you export them, from every mission
  since the last export, as one local zip in Downloads, or discard them.
  HexDesk never writes or uploads a report on its own. A report leaves out
  black captures and repeated captures of a screen that did not change. The
  zip has no folders: every file starts with the overlay that read it
  (`pick-`, `reward-`, `riven-`), and `flows.json` lists which files were
  answered together. The overlay is captured as its own window, never as the
  whole desktop or monitor. In endless fissures the relic selection after a
  reward is asked about together with the reward it leads to, also when the
  selection screen opens more than once.
- **Remove logs** in the activity console clears existing diagnostic logs,
  saved OCR captures and test data not yet saved as a report, after
  confirmation. Logging then continues in a fresh active-session log without
  changing log retention.
- An activity console in Settings → Console shows what HexDesk does in the
  background as it happens. Filter by level and by one or more sources, with
  each overlay (overlay key, Relic Pick, Relic Reward, riven check) as its
  own source. Open an entry to see its details and the reason it failed,
  follow one inventory scan or overlay from start to end, and copy lines for
  a bug report.
- A diagnostics export in the activity console saves a single zip to your
  Downloads folder, ready to attach to a bug report. Choose what goes in:
  system information, your settings, the activity entries and the log files.
  Passwords, tokens, e-mail addresses and player names are removed from it.
- Check for updates yourself in Settings → General, and install one from
  there.
- The navigation sidebar can collapse to icons only. Click the empty space
  between the screens and Report a bug to collapse or expand it; HexDesk
  remembers your choice. When collapsed, hover or focus an icon to see its
  name. HexDesk starts collapsed, and narrow windows always show icons only.
- Press Home to hide the overlays on screen. With none on screen, Home opens
  the overlay for the screen you are on, without waiting for the game's log:
  Relic Pick on the relic selection and refinement screens, Relic Reward on
  the fissure reward screen and the riven check on the mods screen. Choose
  another key, or none, in Settings → Overlays. The game still receives the
  key as well. The activity console says what each press did, and with "Save
  what OCR reads on screen" on it also shows the part of the screen that was
  read.
- The activity console follows each visit to a relic selection screen from
  start to end: what opened it, the era read from the screen, what the
  overlay showed and what closed it.
- Manual mode in Settings → Overlays: overlays open only when you press the
  overlay key, and the screen is read only then. The game's log still
  closes them.
- "Save the areas each screen read uses" in the activity console saves the
  game window with the parts HexDesk reads outlined: the screen title, the
  relic list, the reward cards and the riven card.
- An overlay key press that opens an overlay is one entry group in the
  activity console, together with everything that overlay did until it
  closed. The Relic Reward read lists the relics it narrowed the rewards to
  by name, and where they came from.
- "Save a screenshot when an overlay is shown" in the activity console saves
  only the HexDesk overlay window each time it is drawn. The game capture and
  overlay image stay separate, so neither includes the rest of the desktop.
- A short, click-through status line at the top centre of the game shows what
  the overlays are doing, such as reading the screen, retrying or showing an
  overlay. Turn it off, change how long it stays visible or move it in
  Settings → Overlays → Status.
- "Read small text more accurately" in Settings → General downloads about
  12 MB of OCR models once. They read what Windows OCR misses, such as relic
  counts and refinement tags. Without them HexDesk reads with Windows OCR
  alone. The activity console shows which engine read each screen and how
  long it took.

### Changed

- Settings → General starts with appearance, windows and notifications, then
  what HexDesk reads from the game (memory scanner, screen reading, testing),
  and ends with your version, updates and the welcome screen.
- The overlay key is set by clicking its field and pressing the key, instead
  of picking from a list. Letters, digits, arrows, the numpad and F13 to F24
  can now be used too. The × in the field or Backspace removes the key, and
  manual mode warns when there is none.
- Settings is a full screen instead of a pop-up. Its categories are listed in
  a column next to the navigation, Settings reopens on the category you used
  last, and the changelog and modular window are hidden while it is open.
  The HexDesk logo and version sit at the bottom of the category column.
- An available update shows as a red dot on Settings, and on General inside
  it, instead of a button in the header.
- New navigation icons for Inventory, Foundry, Relics, Rivens, Timers and
  Market that match their screens, shown larger in the sidebar.
- The collapsed modular window shows its name along the bar, and clicking
  anywhere on the bar opens it again. The open modular window collapses from
  the strip along its bottom, level with the changelog bar.
- The changelog works as it did before the redesign: click the empty part
  of its bar to open or close it, click the text on the bar to see recent
  changes in Inventory, the collapsed feed shows the full change with
  category and old and new quantity, new changes slide into the open list,
  and a right-click on a change opens the wiki menu. Each change shows its
  date as well as its time, and rows alternate in shade so each line is easy
  to follow.
- Choose what "Changed recently" counts in Settings → Filters: since HexDesk
  started, the last hour, the last 24 hours, the last 7 days or everything in
  the changelog. The filter, the recent sort and the change badge on items
  all follow it, and the badge now shows how long ago in minutes, hours or
  days instead of disappearing after five minutes.
- The logs now say why something failed instead of only that it failed, for
  example when Warframe's memory could not be read, no inventory was found,
  warframe.market refused a request, or a relic overlay took long to appear.
  Repeated identical lines are collapsed into one line with a count.
- Error messages for warframe.market actions now name what failed and how
  warframe.market answered.
- The Relic Reward overlay appears as soon as two reads of the reward screen
  agree on every card, instead of reading the screen several more times. A
  card whose name was only partly read, or read differently between reads,
  is marked "Uncertain". The activity console lists every card of each
  read: the text read, the reward it matched, how well it matched and the
  next best rewards.
- Relic Reward keeps four closely spaced reward cards separate, and Relic Pick
  no longer recommends an inventory relic that its complete on-screen list
  did not confirm when OCR misses a tile. While Relic Reward is visible, title
  OCR now also closes or replaces it when the game leaves the reward screen,
  as a fallback for delayed EE.log lines.
- Relic Pick opens sooner: it stops reading the relic list as soon as two
  reads agree on the relics, refinements, ownership and counts, instead of
  reading again while unrecognized text on screen keeps changing. Faded
  tiles, relics you do not have, are no longer read a second time. Relic
  names and refinement tags are recognized despite small OCR errors.
- Relic Pick reads the count badges ("x3") and refinement tags of your relics
  on their own when the list read skipped them, and a name OCR dropped is
  read again. With "Read small text more accurately" on, the extra OCR
  models read what Windows OCR still could not.
- The riven check runs in the background instead of in the main window,
  like the relic overlays. It opens on the riven screen, closes when you
  leave it, and the activity console follows each visit to the riven screen:
  what opened it, what each check read and whether the overlay was drawn.
  "Check Riven" and "New roll" only run while the riven overlay is turned on.
- Your Windows user name and player names no longer appear in log files.
- Settings → Debugging is gone from release builds; the diagnostics export
  is in the activity console. What the old debugging tools wrote to separate
  files is in the log and the activity console.

### Removed

- The old debugging tools from Settings → Debugging: the overlay log, relic
  captures, manual capture, inventory snapshots, memory probe, raw memory
  record, memory relic debug, the relic pick OCR and overlay tests, the EE.log
  tail, unmatched paths and the incoming batch preview. Inventory items the
  catalogue cannot place are now listed in the log instead.
- The Session log button on the Rivens screen; riven reads are in the
  activity console.
- The separate session and debug files HexDesk wrote to your temporary folder.
  Debug files that earlier versions left behind, such as inventory snapshots,
  memory dumps, captures and session logs, are deleted when HexDesk starts.

### Fixed

- Status lines and testing messages over the game that run over two lines
  are no longer cut off, also when several show one after another.
- The inventory and the changelog update right after a mission instead of
  about two minutes later. The account data read then was rejected as
  incomplete because the game leaves one section out at that moment.
- "Changed recently" in Inventory no longer shows everything that ever
  changed. By default it shows what changed since HexDesk started.
- The main window is called HexDesk again in Alt+Tab, the taskbar and Task
  Manager.
- Clicking an active filter preset again turns it off, in Inventory, Foundry
  and Market. With "Restore previous filters" on, it brings back the filters
  you had before.
- The Relic Pick overlay closes by itself again when you pick a relic, back
  out to the star chart, the mission starts or, in an endless fissure, every
  player has voted. It no longer opens after the selection screen has already
  closed, and it hides after two minutes if the game never reports that the
  screen closed. It also opens when the relic list was still drawing at the
  moment the game reported it.
- The overlay key recognises the fissure reward screen when one letter of its
  title is misread.
- The Relic Pick overlay reads the relic list on screen and follows it: it no
  longer recommends a relic you used up during a mission, shows the count on
  the relic's tile when the game shows one, and marks a relic it could not
  find on the list as "not on screen".
- The Relic Reward and Relic Pick overlays agree on what you own: both count
  a part, its blueprint, Foundry jobs, a built item and rewards received
  since the last inventory scan the same way, and the activity console says
  for each reward card where every count comes from.
- The Relic Reward overlay counts the warframe part blueprints you own
  (chassis, neuroptics, systems) again, so a set no longer shows those
  parts as missing.
- With the Relic Reward overlay turned off in Settings → Overlays, HexDesk
  no longer reads the reward screen in the background.
- Turning the Relic Reward or riven overlay on or off takes effect at once,
  instead of after a restart.
- The Riven overlay no longer has a second border around it.
- The mouse cursor shows over the Relic Pick overlay, as it does over the
  Riven overlay, and its close button can be clicked.
- The Relic Pick overlay shows the rewards of each relic again after a
  restart, instead of only the relic names.

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
