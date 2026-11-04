# Working on Folio (for AI assistants)

This file is for any AI coding assistant working in this repository (Claude, Codex, Gemini,
Copilot, Cursor, …). Read it before you start, follow it while you work, and **add yourself to
the [contributor list](#ai-contributors) when you are done**.

## What Folio is

Folio is a desktop Markdown reader and editor for Windows and Linux, in the spirit of Typora:
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
3. **Plain Markdown files.** Whatever Folio writes must stay readable in other tools. Extensions use
   existing conventions (`<u>`, `> [!NOTE]`, `<div style="page-break-after: always;">`).
4. **Keyboard first.** Every feature is a menu item with a shortcut and shows up in the command
   palette (`F1`).
5. **Windows and Linux are equal.** Test both mentally: WebView2 on Windows, WebKitGTK on Linux
   (no native `<select>` popups, see `customSelect`; Wayland quirks).
6. **Word-processor quality writing tools**, on the level people know from Word: the spelling and
   grammar checker is the most important feature after editing itself.
7. **Optional extras stay optional.** Playful or intrusive features (WPM meter, typing cat) are off
   by default.

## Map of the code

| Path | What it does |
| --- | --- |
| `src/main.js` | The app: state, settings (`DEFAULTS`), editor setup, files, find/replace, outline, preferences, menus (`MENU`), shortcuts, boot |
| `src/writing.js` | Spelling & grammar UI for both editors: block extraction, cache, underlines, right-click menu, F7 panel, dictionary |
| `src/writing-engine.js` | Checker engines (lazy): Harper in a web worker, LanguageTool over HTTP |
| `src/autocorrect.js` | AutoCorrect input rule (typo list, `i` → `I`, two initial capitals) |
| `src/typingtest.js` | Typing test overlay (lazy) |
| `src/companion.js` | WPM meter and typing cat |
| `src/source.js` | Source mode + Vim (lazy) |
| `src/export.js` | HTML export and print-to-PDF (lazy) |
| `src/updater.js` | In-app updates (lazy): check, signed download, install, restart |
| `src/blocks.js`, `src/underline.js` | Page breaks, callouts, underline mark |
| `src/style.css` | Themes (CSS variables per `data-theme`) and all styles |
| `src/guide.md` | Help → Markdown Guide (shown in the app) |
| `src-tauri/src/lib.rs`, `pdf.rs` | Tauri commands (file I/O, folder search, windows), PDF stamping |
| `scripts/ai-stats.mjs` | Counts lines per model for the About dialog |
| `packaging/arch/PKGBUILD` | Arch package (`folio-bin`) made from the release `.deb`; built by release.yml |
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
- New UI must work in all four themes (use the CSS variables) and at small window sizes.
- Update `README.md` and `src/guide.md` when you add or change user-facing features.
  Regenerate screenshots with `npm run screenshots` when the UI changes visibly.
- Bump the version in `package.json` (+ `package-lock.json`), `src-tauri/tauri.conf.json` and
  `src-tauri/Cargo.toml` (+ `Cargo.lock`) only for a release. Pushing a `vX.Y.Z` tag runs
  `.github/workflows/release.yml`, which builds Windows and Linux files into a draft release.
  Builds are signed for the in-app updater (see README → Signed updates); never commit the private key.

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
