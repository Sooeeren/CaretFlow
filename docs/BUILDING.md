# Building CaretFlow

CaretFlow is a Tauri 2 app: a Rust backend and a plain JavaScript frontend built with Vite.

## Quick start

```sh
npm install
npm run app:dev           # hot-reload dev mode (needs Rust)
npm run app:build         # Windows only (src-tauri/target/release/…)
npm run app:build:linux   # Linux only (via WSL from Windows)
npm run app:build:all     # Windows + Linux → release/windows, release/linux
npm run screenshots       # regenerate docs/screenshots (needs Chrome or Edge)
```

`npx vite build` must pass before you commit.

## Outputs

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `release/windows/CaretFlow_*_x64-setup.exe` | installer, registers `.md` files |
| Windows | `release/windows/CaretFlow-portable.exe` | runs without installing (needs WebView2, preinstalled on Win 10/11) |
| Linux | `release/linux/CaretFlow_*_amd64.AppImage` | portable: `chmod +x` and run |
| Linux | `release/linux/CaretFlow_*_amd64.deb` | `sudo apt install ./CaretFlow_*.deb` |
| Linux | `release/linux/caretflow-*.x86_64.rpm` | RHEL/Fedora/openSUSE: `sudo dnf install ./caretflow-*.rpm` |
| Linux | `caretflow-bin-*-x86_64.pkg.tar.zst` (releases only) | Arch/Manjaro: `sudo pacman -U ./caretflow-bin-*.pkg.tar.zst` |
| Linux | `release/linux/caretflow` | raw binary, needs `libwebkit2gtk-4.1` installed |

## Linux prerequisites (one time)

From Windows, the Linux build runs inside WSL (default distro `Ubuntu`; pass `-Distro <name>` to
`scripts/build-all.ps1` for another). On a fresh distro / Linux machine:

```sh
sudo bash scripts/linux-setup.sh     # apt deps (webkit2gtk 4.1 etc.) + Rust + Node 22 for your user
bash scripts/build-linux.sh          # on native Linux
```

## Working on the frontend only

The frontend runs without Rust against a stubbed backend:

```sh
node scripts/screenshots.mjs --out <tmp dir>
```

This starts Vite and a local Chrome/Edge and saves screenshots. Pass `--extra my-scenes.mjs` with an
exported `scenes` object to script your own checks, `--built` to test the production build, or
`EVAL='…'` to evaluate an expression in the page.

## Code layout

- `src/main.js` – app: editor, files, find/replace, outline, palette, menus, shortcuts, settings
- `src/writing.js` – spelling & grammar UI for both editors (underlines, menu, F7 panel, dictionary)
- `src/writing-engine.js` – checker engines: Harper (WebAssembly worker) and LanguageTool (lazy-loaded)
- `src/autocorrect.js` – AutoCorrect while typing
- `src/typingtest.js` – typing test (lazy-loaded); `src/companion.js` – WPM meter and typing cat
- `src/source.js` – source-code mode + Vim (lazy-loaded)
- `src/export.js` – HTML export / print-to-PDF (lazy-loaded)
- `src/updater.js` – update check, download, install and restart (lazy-loaded)
- `src/blocks.js`, `src/underline.js` – page breaks, callouts, underline
- `src/style.css` – themes (Paper, Sepia, Ink, Slate) and typography
- `src-tauri/src/lib.rs` – file I/O commands (atomic save, folder listing, folder search); `pdf.rs` – PDF stamping
- `scripts/` – build scripts, AI line statistics, README screenshots

AI assistants: see [AGENTS.md](../AGENTS.md) for the fuller map and conventions.

## Logs

Errors are logged to `%TEMP%\caretflow.log` (`/tmp/caretflow.log` on Linux).

For how releases are built, signed and published, see [RELEASING.md](RELEASING.md).
