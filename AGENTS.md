# Working on CaretFlow (for AI assistants)

This file is for any AI coding assistant working in this repository (Claude, Codex, Gemini,
Copilot, Cursor, …). Read it before you start, follow it while you work, and **add yourself to
the [contributor list](#ai-contributors) when you are done**.

## What CaretFlow is

CaretFlow was called Folio until 0.5.0. Internal names keep the old one on purpose: the app
identifier `app.folio.markdown` (settings, recent files and window state live under it), the
`folio.*` localStorage keys and temp file names, and the GitHub repository `Sooeeren/folio`.


CaretFlow is a Markdown reader and editor for Windows, Linux and Android, in the spirit of Typora:
documents are edited in their rendered form (WYSIWYG), with the raw Markdown one shortcut away.
It is a Tauri 2 app: a Rust backend for file access and PDF stamping, and a plain JavaScript
frontend (no framework) built with Vite.

Main features: live rendered editing (Milkdown/ProseMirror), source mode with Vim (CodeMirror 6),
spelling and grammar checking (Harper offline, LanguageTool optional), PDF/HTML export with page
preview, file tree / outline / folder search, themes, a typing test and small typing extras.

## Goals

These decide most design questions:

1. **Writing comes first.** The editor must feel instant and quiet. Nothing may lag typing; heavy
   work goes to workers, is debounced, cached, or lazy-loaded (`import()` on first use).
2. **Private by default.** No network access unless the user turns it on (LanguageTool is opt-in
   and says where text goes). No telemetry.
3. **Plain Markdown files.** Whatever CaretFlow writes must stay readable in other tools. Extensions use
   existing conventions (`<u>`, `> [!NOTE]`, `<div style="page-break-after: always;">`).
4. **Keyboard first.** Every feature is a menu item with a shortcut and shows up in the command
   palette (`F1`).
5. **Windows and Linux are equal**, and Android gets every feature it can run. Test them mentally:
   WebView2 on Windows, WebKitGTK on Linux (no native `<select>` popups, see `customSelect`; Wayland
   quirks), Android's WebView with touch and one window (`IS_ANDROID` in `platform.js`; dialogs that
   need files go through `pickFile`/`pickFolder`/`pickSave`, never the dialog plugin directly).
6. **Word-processor quality writing tools**, on the level people know from Word: the spelling and
   grammar checker is the most important feature after editing itself.
7. **Optional extras stay optional.** Playful or intrusive features (WPM meter, typing cat) are off
   by default.

## Map of the code

| Path | What it does |
| --- | --- |
| `src/main.js` | The app: state, settings (`DEFAULTS`), editor setup, files, find/replace, outline, preferences, menus (`MENU`), shortcuts, boot |
| `src/writing.js` | Spelling & grammar UI for both editors: block extraction, cache, underlines, right-click menu, F7 panel, dictionary |
| `src/writing-engine.js` | Checker engines (lazy): Harper in a web worker, LanguageTool over HTTP, Hunspell for other languages |
| `src/languages.js`, `src/spell-core.js`, `src/spell-worker.js`, `src/dictionaries.js` | Other languages: dictionary list and paragraph language detection, Hunspell (WebAssembly) in a worker, downloading dictionaries into the data folder |
| `src/ltlocal.js`, `src-tauri/src/langtool.rs` | Advanced Grammar (lazy, an extension, desktop only): downloads LanguageTool + a Java runtime, runs the server on 127.0.0.1, stops it when idle or on exit; `data_dir`/`data_remove` for downloaded language data |
| `src/autocorrect.js` | AutoCorrect input rule (typo list, `i` → `I`, two initial capitals) |
| `src/typingtest.js` | Typing test overlay (lazy) |
| `src/companion.js` | WPM meter and typing cat |
| `src/source.js` | Source mode + Vim (lazy) |
| `src/material.js` | Material You style: a Material 3 color scheme from one seed color (OKLCH tonal palettes), laid over the theme; shapes in `style.css` under `body.material` |
| `src/codestyle.js` | Syntax colors shared by code blocks, source mode and exports (`--tok-*` per theme) |
| `src/export.js` | HTML export and print-to-PDF (lazy) |
| `src/updater.js` | In-app updates (lazy): check, signed download, install, restart |
| `src/extensions.js` | The extension catalog (`EXTENSIONS`) and installed state (`settings.extensions`) |
| `src/ai.js` | AI Writing Help (lazy, an extension): providers (Anthropic + OpenAI-compatible), limits and usage, live checking of finished paragraphs, the AI tab of the review panel, Preferences → AI, the MCP setup guide |
| `src/mcp.js` | MCP tool answers (document, selection, suggestions) and Preferences → AI → MCP server |
| `src/discord.js`, `src-tauri/src/discord.rs` | Discord Status (lazy, an extension, desktop only): Rich Presence over Discord's local IPC pipe/socket, Preferences → Discord with a preview |
| `src/cloud.js` | Cloud Sync (lazy, an extension): WebDAV / S3 (SigV4) / rclone backends, two-way sync, Cloud sidebar tab, status-bar button, Preferences page |
| `src/blocks.js`, `src/underline.js` | Page breaks, callouts, underline mark |
| `src/style.css` | Themes (CSS variables per `data-theme`) and all styles |
| `src/guide.md` | Help → Markdown Guide (shown in the app) |
| `src/welcome.md` | Welcome page, shown on the very first start and from Help → Welcome Page |
| `src/platform.js` | What differs between desktop and Android: `IS_ANDROID`, file/folder/save pickers, opening files in other apps |
| `src/android.js` | Android only (lazy): app bar, menu and sidebar drawers, formatting bar, back button, CaretFlow's file browser, "Open with"/"Share", drafts, print, APK update check |
| `src/linenumbers.js` | Every-fifth-line numbers in the rendered view, measured from the text layout |
| `src/caret.js` | The text cursor CaretFlow draws itself in the rendered view (Linux default; WebKitGTK leaves stale carets) |
| `src-tauri/windows/installer-hooks.nsh` | Windows installer hooks: remove an old Folio install, recreate its shortcuts |
| `src-tauri/src/lib.rs`, `pdf.rs` | Tauri commands (file I/O, folder search, windows), PDF stamping |
| `src-tauri/src/cloud.rs` | Cloud Sync commands: HTTP (reqwest, also used by AI), folder scan, sync trash, `secrets.json`, running rclone |
| `src-tauri/src/android.rs`, `src-tauri/gen/android` | Android: bridge to `CaretFlowPlugin.kt` (content:// files, storage permission, share, print, PDF via `PdfPrint.java`); the Gradle project with manifest, icons and signing |
| `src-tauri/src/mcp.rs` | The MCP server (Streamable HTTP on 127.0.0.1, token) and the `caretflow --mcp` stdio bridge; unit tests run in CI |
| `src/html.js` | HTML in Markdown shown rendered (cleaned with DOMPurify) and edited as source on click |
| `src/frontmatter.js` | Front matter (`---` YAML / `+++` TOML at the top): parsed with remark-frontmatter, shown as a properties panel, edited as text on click |
| `scripts/checks/` | UI checks: scene modules for `scripts/screenshots.mjs --extra` that print PASS/FAIL (extensions, AI, MCP, HTML, front matter, right-click) |
| `.github/workflows/check.yml` | Compiles the app on Windows and Linux, and a debug APK, for every push and pull request |
| `docs/` | User docs: `SHORTCUTS.md`, `FEATURES.md`, `ANDROID.md`, `EXTENSIONS.md`, `CLOUD-SYNC.md`, `AI.md`, `MCP.md` (also opened in the app), `LANGUAGETOOL.md`, `NOTES.md`; `BUILDING.md`, `RELEASING.md` for developers |
| `scripts/ai-stats.mjs` | Counts lines per model for the About dialog |
| `packaging/rpm/caretflow.spec`, `scripts/rpm-repackage.sh`, `scripts/deb-repackage.sh` | The `.rpm` and `.deb`, rebuilt from Tauri's as `caretflow`, replacing the old Folio packages |
| `packaging/arch/PKGBUILD` | Arch package (`caretflow-bin`) made from the release `.deb`; built by release.yml |
| `scripts/update-manifest.mjs` | Writes `latest.json` (the updater manifest) from signed release files |
| `scripts/screenshots.mjs` | Runs the frontend in Chrome/Edge with a fake Tauri backend; README screenshots and UI checks |

## How to work here

- `npm install`, then `npm run app:dev` for the real app (needs Rust), or work on the frontend
  alone: `node scripts/screenshots.mjs --out <tmp dir>` runs Vite + a local Chrome/Edge with a
  stubbed backend and saves screenshots you can look at. Pass `--extra my-scenes.mjs` with an
  exported `scenes` object to script your own checks (see the scenes in the script), `--built` to
  test the production build, `EVAL='…'` to evaluate an expression in the page.
- `npx vite build` must pass before you commit.
- Match the existing style: ES modules, no semicolons, single quotes, 2-space indent, small helper
  functions, `el()` for DOM, comments that explain *why*.
- New settings go into `DEFAULTS` in `main.js`; add them to Preferences and, if useful, the menus.
- Bigger optional features are **extensions**: add an entry to `EXTENSIONS` in `src/extensions.js`
  (texts, icon, two screenshots made by `scripts/screenshots.mjs` scenes with `webp:`), tag their menu
  items with `ext: '<id>'`, gate their UI and background work with `extOn('<id>')` in `main.js`
  (`applyExtensions()` runs on install/remove), and load their code lazily.
- UI checks: `node scripts/screenshots.mjs <scene> --extra scripts/checks/<file>.mjs --out <tmp>`;
  every scene must end with `ALL PASSED`.
- New UI must work in all four themes (use the CSS variables) and at small window sizes.
- Update `README.md` (short overview), the matching file in `docs/` and `src/guide.md` when you add or
  change user-facing features; new shortcuts go into `docs/SHORTCUTS.md`.
  Regenerate screenshots with `npm run screenshots` when the UI changes visibly.
- Bump the version in `package.json` (+ `package-lock.json`), `src-tauri/tauri.conf.json` and
  `src-tauri/Cargo.toml` (+ `Cargo.lock`) only for a release. Pushing a `vX.Y.Z` tag runs
  `.github/workflows/release.yml`, which builds Windows and Linux files into a draft release.
  Builds are signed for the in-app updater (see docs/RELEASING.md → Signed updates); never commit the private key.
- Releasing, step by step:
  1. Commit the version bump (`Release X.Y.Z` plus a short list of changes); in
     `packaging/arch/PKGBUILD` set `_ver` and `sha256sums=('SKIP')`.
  2. Write the release notes (same layout as the previous release: New / Fixed / Updating / Downloads,
     no comparisons to other apps), push the commit and the `vX.Y.Z` tag, and **right away** create
     the draft yourself: `gh release create vX.Y.Z --draft --title "CaretFlow X.Y.Z" --notes-file notes.md`.
     The release is then listed as made by the repository owner, not by `github-actions[bot]`, and
     the workflow puts the notes into `latest.json`, so the update popup shows them.
  3. When the workflow is done, put the sha256 of the release `.deb` into `PKGBUILD`
     (`PKGBUILD: checksum of the X.Y.Z .deb`) and publish the draft only when asked to.
  4. The website lives in a separate repository, <https://github.com/Sooeeren/CaretFlow-Web>, and
     shows the current version. Check whether you can push to it (`gh repo view Sooeeren/CaretFlow-Web
     --json viewerPermission`). If you have write access, update it to the new version yourself. If you
     don't, fork it and open a pull request with the new version instead. Don't skip this step.

## Commits and credit

Make focused commits (one feature or fix each) with a short subject and a body that says what
changed for users. **End every commit message with a co-author trailer naming your model**, e.g.

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

`scripts/ai-stats.mjs` reads these trailers to credit lines to models in Help → About. If your tool
cannot add a trailer, add the commit hash and model name to `scripts/ai-attribution.json`.
Use your exact model name and version, so the About dialog stays accurate.

## AI contributors

Add a row when you finish a piece of work (newest last). Keep it short.

| Model | Tool | Date | Work |
| --- | --- | --- | --- |
| Claude Opus 5.5 | Claude Code | 2026-11 | Initial version: editor, source mode, Vim, files, export, themes |
| Claude Opus 5.5 | Claude Code | 2026-11-03 | 0.1.1–0.3.0: Vim visual increment and block mode, PDF export options, page preview, callouts, custom title bar, Linux fixes |
| Claude Opus 5.5 | Claude Code | 2026-11-03 | Spelling & grammar check (Harper/LanguageTool, F7 panel, AutoCorrect), typing test, WPM meter, typing cat, per-model About stats, README screenshots, this file |
| Claude Opus 5.5 | Claude Code | 2026-11-04 | In-app updater: update popup, signed download and install, restart; signed release builds and `latest.json` |
| Claude Opus 5.5 | Claude Code | 2026-11-04 | Arch package, folio-markdown rpm, issue #4 (code colors in exports, line numbers, Vim command line, heading spacing, sliders/zoom, Close Folder), Preferences categories |
| Claude Opus 5.5 | Claude Code | 2026-11-04 | Rename to CaretFlow with the new icon (Windows installer migration, caretflow packages), JetBrains code colors, Word-style line numbers, Close File, welcome page |
| Claude Opus 5.5 | Claude Code | 2026-11-04 | Issues #8/#9: drawn caret on Linux, no giant caret beside tables, Vim command line without scroll jumps, custom shortcuts (Preferences → Keyboard) |
| Claude Opus 5.5 | Claude Code | 2026-11-04 | GitHub issue forms (bug report, feature request), README download link to the CaretFlow repo |
| Claude Sonnet 5.5 | Claude Code | 2026-11-05 | README split (docs/BUILDING.md, docs/RELEASING.md), Install and comparison sections, Dependabot, cargo/npm audit workflow, PKGBUILD url and license |
| Claude Opus 5.5 | Claude Code | 2026-11-06 | Dependabot PRs #11–#18 checked and merged (lopdf, pdfjs-dist, playwright-core, Actions); windows-core/webview2-com pinned to Tauri |
| Claude Opus 5.5 | Claude Code | 2026-11-06 | Cloud Sync (WebDAV, S3, rclone for Google Drive / Proton Drive), Cloud sidebar tab, build-check workflow, README split into docs/ |
| Claude Opus 5.5 | Claude Code | 2026-11-06 | Extensions (Preferences tab; Cloud Sync and Typing Test moved there), AI Writing Help (API key / local models, live checking, AI review tab, limits), MCP server and `--mcp` bridge, UI checks in scripts/checks |
| Claude Opus 5.5 | Claude Code | 2026-11-07 | Material You style (all platforms; wallpaper colors on Android 12+), scripts/checks/material.mjs |
| Claude Opus 5.5 | Claude Code | 2026-11-07 | Android version: touch layout, file browser and all-files access, Open with/Share, PDF export and printing via Android, drafts, APK builds in CI and releases |
| Claude Opus 5.5 | Claude Code | 2026-11-09 | Android fixes: crash on the first HTTPS request, drafts lost after a restart, print dialog, PDF export time limit, replayed intents, content:// names and access; scripts removed from exports; case-sensitive paths on Linux/Android; Cloud Sync race |
| Claude Opus 5.5 | Claude Code | 2026-11-10 | Menus sorted: new Insert and Tools menus, themes and Vim under View, the Settings menu split up; custom shortcuts follow moved commands. HTML in Markdown rendered (src/html.js, scripts/checks/html.mjs); extensions notice removed |
| Claude Opus 5.5 | Claude Code | 2026-11-10 | 0.10.0 release; images scale with the window; own right-click menu instead of the webview's (scripts/checks/contextmenu.mjs) |
| Claude Opus 5.5 | Claude Code | 2026-11-11 | Front matter: properties panel in the rendered view, YAML colors in source mode, Insert → Front Matter (scripts/checks/frontmatter.mjs) |
| Claude Sonnet 5.5 | Claude Code | 2026-11-11 | Callout title drawn once when spelling underlines split the marker; 0.10.4 release |
| Claude Opus 5.5 | Claude Code | 2026-11-11 | 0.10.4 tag, draft release and PKGBUILD checksum |
| Claude Opus 5.5 | Claude Code | 2026-11-12 | Discord Status extension: Rich Presence over Discord's local IPC (no crate), Preferences → Discord with a live preview (scripts/checks/discord.mjs) |
| Claude Opus 5.5 | Claude Code | 2026-11-12 | Spelling: other languages (detection, Hunspell dictionaries offered on demand), custom words in Harper, Word-like case rules, folder and front matter word lists, Ignore All per file, LanguageTool presets and Premium; Advanced Grammar extension (LanguageTool on this computer); taskbar-sized icon (scripts/checks/spelling.mjs) |
| Claude Opus 5.5 | Claude Code | 2026-11-12 | Privacy Policy and Terms of Service (docs/PRIVACY.md, docs/TERMS.md), also built into the website's /privacy/ and /terms/ for Discord app verification |
