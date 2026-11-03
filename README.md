# Folio

A fast, seamless (WYSIWYG) Markdown reader & editor for Windows and Linux, inspired by Typora.
Tauri 2 (Rust + system webview), Milkdown/ProseMirror for live editing, CodeMirror 6 for source mode.

## Build

```sh
npm install
npm run app:build:all     # Windows + Linux → release/windows, release/linux
npm run app:build         # Windows only (src-tauri/target/release/…)
npm run app:build:linux   # Linux only (via WSL from Windows)
npm run app:dev           # hot-reload dev mode
```

Outputs:

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `release/windows/Folio_*_x64-setup.exe` | installer, registers `.md` files |
| Windows | `release/windows/Folio-portable.exe` | runs without installing (needs WebView2, preinstalled on Win 10/11) |
| Linux | `release/linux/Folio_*_amd64.AppImage` | portable: `chmod +x` and run |
| Linux | `release/linux/Folio_*_amd64.deb` | `sudo apt install ./Folio_*.deb` |
| Linux | `release/linux/Folio-*.x86_64.rpm` | RHEL/Fedora/openSUSE: `sudo dnf install ./Folio-*.rpm` |
| Linux | `release/linux/folio` | raw binary, needs `libwebkit2gtk-4.1` installed |

### Linux prerequisites (one time)

From Windows, the Linux build runs inside WSL (default distro `Ubuntu`; pass `-Distro <name>` to
`scripts/build-all.ps1` for another). On a fresh distro / Linux machine:

```sh
sudo bash scripts/linux-setup.sh     # apt deps (webkit2gtk 4.1 etc.) + Rust + Node 22 for your user
bash scripts/build-linux.sh          # on native Linux
```

## Vim mode

Settings → **Vim Keybindings** (`Ctrl+Alt+V`). Vim keys apply in source-code mode (`Ctrl+/`);
enable **Open Files in Source Mode** to always edit that way. Supported: normal/insert/visual/
visual-block modes, motions, operators, registers, marks, macros, `/` search, `:s`, plus
`:w`, `:w name`, `:q`, `:q!`, `:wq`, `:x`, `:e [file]` (no file = quick open) and `:pre` to go back
to the rendered view. Vim's Ctrl keys (`Ctrl+D/U/F/B/O/I/V/R/…`) go to Vim inside the editor.
In visual mode `Ctrl+A`/`Ctrl+X` add/subtract on every selected line and `g Ctrl+A`/`g Ctrl+X`
increment progressively (1, 2, 3, …), including in `Ctrl+V` block selections.

## Notes

- **Underline** (`Ctrl+U`) is saved as `<u>text</u>`, since Markdown has no underline syntax.
- **Print / Export PDF** uses a light print theme by default (Settings → Export / PDF Theme).
- **Linux** uses a themed title bar and the desktop's native (xdg-portal) file dialogs;
  Settings → Use System Title Bar switches back to the GTK one.

## Layout

- `src/main.js` – app: editor, files, find/replace, outline, palette, menus, shortcuts, settings
- `src/source.js` – source-code mode + Vim (lazy-loaded)
- `src/export.js` – HTML export / print-to-PDF (lazy-loaded)
- `src/style.css` – themes (Paper, Sepia, Ink, Slate) and typography
- `src-tauri/src/lib.rs` – file I/O commands (atomic save, folder listing, folder search)
- `scripts/` – cross-platform build scripts

Errors are logged to `%TEMP%\folio.log` (`/tmp/folio.log` on Linux).
