# CaretFlow

<img src="src-tauri/icons/128x128@2x.png" width="96" align="right" alt="">

**A fast, quiet Markdown editor for Windows and Linux.** You write, CaretFlow renders it in place:
no split preview, no clutter. Raw Markdown and Vim are one shortcut away, and a built-in spelling
and grammar checker catches mistakes as you type.

CaretFlow was called **Folio** until 0.5.0. Updating keeps your settings; the Windows installer removes
the old Folio install.

![CaretFlow editing a Markdown file with the file sidebar open](docs/screenshots/hero.png)

<p align="center">
  <a href="https://github.com/Sooeeren/CaretFlow/releases/latest"><b>Download the latest release</b></a> ·
  <a href="#install">Install</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="docs/BUILDING.md">Build from source</a>
</p>

Built with Tauri 2 (Rust + the system webview), Milkdown/ProseMirror for live
editing and CodeMirror 6 for source mode.

## Install

Pick a file from the [latest release](https://github.com/Sooeeren/CaretFlow/releases/latest):

| Platform | File | How |
| --- | --- | --- |
| Windows | `CaretFlow_*_x64-setup.exe` | Installer; registers `.md` files |
| Windows | `CaretFlow-portable.exe` | Runs without installing (needs WebView2, preinstalled on Windows 10/11) |
| Linux (any) | `CaretFlow_*_amd64.AppImage` | `chmod +x` and run |
| Debian / Ubuntu | `CaretFlow_*_amd64.deb` | `sudo apt install ./CaretFlow_*.deb` |
| Fedora / RHEL / openSUSE | `caretflow-*.x86_64.rpm` | `sudo dnf install ./caretflow-*.rpm` |
| Arch / Manjaro | `caretflow-bin-*-x86_64.pkg.tar.zst` | `sudo pacman -U ./caretflow-bin-*.pkg.tar.zst` |

The Windows installer, AppImage, `.deb` and `.rpm` update themselves from inside the app. To build
CaretFlow yourself, see [docs/BUILDING.md](docs/BUILDING.md).

## How is CaretFlow different?

CaretFlow sits closest to [Typora](https://typora.io): you write in the rendered document, and the raw
Markdown is one shortcut away. The differences are in what it is built around.

- **Compared with Typora**, CaretFlow is open source (MIT), and spelling and grammar checking, Vim
  mode and PDF export with page preview are built in.
- **Compared with Obsidian**, it is a file editor, not a knowledge base: you open a file or a folder
  and write, with no vault, plugins or linking features to set up.
- **Compared with MarkText and Zettlr**, which are Electron apps, CaretFlow uses Tauri and the system
  webview, so it is a small download that starts quickly. Zettlr aims at academic writing with
  citations; CaretFlow aims at general writing with a Word-style writing check.
- **Private by default**: no telemetry, and no network access unless you turn on LanguageTool.

Other apps change over time, so check their sites for their current features.

**Platforms:** Windows and Linux. There is no macOS build and none is planned right now, but it is
not ruled out. Tauri supports macOS, so it depends on someone being able to build and test it.

## Highlights

- **What you see is what you write.** Headings, tables, task lists, math (KaTeX), Mermaid diagrams,
  callouts and code with syntax highlighting render as you type. `Ctrl+/` shows the raw Markdown.
- **Spelling & grammar, offline.** Red and blue underlines, right-click suggestions, an `F7` review
  panel and AutoCorrect. Nothing leaves your computer unless you choose LanguageTool for other languages.
- **Vim mode** for source editing, including visual block, macros, registers and `:w` / `:q`.
- **PDF export** with page preview, page breaks, headers, footers and page numbers; also from the
  command line.
- **Files and folders**: sidebar with outline, file tree and folder search; quick open (`Ctrl+P`);
  command palette (`F1`).
- **Four themes** (Paper, Sepia, Ink, Slate) plus custom CSS, focus, typewriter and zen modes.
- **Typing test** (`Ctrl+Alt+T`) and optional extras: a live WPM meter and a typing cat.

## Writing check

CaretFlow checks spelling and grammar as you type. Red wavy lines mark spelling, blue double lines
grammar (*their/they're*, *could of*, *a apple*, *I has*, repeated words), and amber dotted lines
optional style hints. Right-click a marked word to fix it, ignore it or add it to your dictionary.

![Right-click menu with spelling suggestions](docs/screenshots/writing.png)

Press `F7` to walk through every issue one by one in a review panel. Number keys pick a
suggestion, `Enter` applies the first one, and a clean document shows readability statistics.

![The Spelling & Grammar review panel in the Sepia theme](docs/screenshots/review.png)

| | |
| --- | --- |
| **Checker** | [Harper](https://writewithharper.com) by default: runs locally (WebAssembly), English in American, British, Canadian, Australian or Indian spelling. [LanguageTool](https://languagetool.org) optionally, for German, French, Spanish and 30+ more languages (public server or your own). |
| **Shortcuts** | `F7` review panel · `Alt+F7` next issue · right-click for suggestions |
| **AutoCorrect** | Fixes common typos while you type (*teh* → *the*, *dont* → *don't*, *i* → *I*). `Backspace` right after a fix undoes it. |
| **Markdown-aware** | Code, inline code, math, links and file names are skipped, in both the rendered and the source view. |
| **Settings** | Preferences → Writing: engine, language, style hints, custom dictionary, rules you turned off. |

## Looks

<table>
  <tr>
    <td><img src="docs/screenshots/dark.png" alt="Ink theme with the outline sidebar"></td>
    <td><img src="docs/screenshots/source.png" alt="Source mode with Vim keybindings in the Slate theme"></td>
  </tr>
  <tr>
    <td align="center">Ink theme, outline sidebar</td>
    <td align="center">Source mode with Vim (<code>Ctrl+/</code>)</td>
  </tr>
</table>

## Typing test

`Ctrl+Alt+T` opens a minimal speed test: 15 to 120 seconds or 10 to 100 words, with optional
punctuation and numbers, or practice on the text of the document you have open. Results show
WPM, accuracy, raw speed, consistency and a per-second chart, and personal bests are kept.

<table>
  <tr>
    <td><img src="docs/screenshots/typing.png" alt="Typing test in progress"></td>
    <td><img src="docs/screenshots/results.png" alt="Typing test results with chart"></td>
  </tr>
</table>

While writing, **View → Typing Speed (WPM)** shows your speed in the status bar and
**View → Typing Cat** adds a small companion that taps along. Both are off by default.

![The typing cat in the corner and the WPM meter in the status bar](docs/screenshots/bongo.png)

## Keyboard shortcuts

`Shift+F1` lists every shortcut, `F1` opens the command palette. Every menu command can get a
different shortcut (or none) in **Preferences → Keyboard** (Help → Customize Shortcuts…). The
defaults most used:

| Action | Keys | Action | Keys |
| --- | --- | --- | --- |
| Source mode | `Ctrl+/` | Spelling & grammar | `F7` / `Alt+F7` |
| Quick open | `Ctrl+P` | Find / replace | `Ctrl+F` / `Ctrl+H` |
| Command palette | `F1` | Page preview | `Ctrl+Alt+L` |
| Sidebar | `Ctrl+Shift+L` | Export PDF | `Ctrl+Alt+E` |
| Focus / typewriter | `F8` / `F9` | Typing test | `Ctrl+Alt+T` |
| Vim keybindings | `Ctrl+Alt+V` | Page break | `Ctrl+Enter` |

## More features

- **Vim mode** (`Ctrl+Alt+V`) works in source mode (`Ctrl+/`): normal, insert, visual and visual-block
  modes, motions, operators, registers, marks, macros, `/` search, `:s`, and commands like `:w`, `:q`,
  `:e` and `:pre` (back to the rendered view). `Ctrl+A` / `Ctrl+X` and `g Ctrl+A` work on selections.
  Turn on **Open Files in Source Mode** to always edit that way. Vim mode shows line numbers (optionally
  relative, like `:set relativenumber`; without Vim, every fifth line can be numbered: Settings → Line
  Numbers), and CaretFlow starts in source mode again when you quit there.
- **PDF export** (`Ctrl+Alt+E`) writes the file directly, no print dialog: paper size, orientation,
  margins, page numbers, header and footer (`{title}` `{file}` `{date}` `{author}`) and document
  properties. **File → Print…** still opens the system dialog.
- **Page preview** (`Ctrl+Alt+L`) shows the real PDF next to the editor, refreshed as you type. Page
  breaks (`Ctrl+Enter`) are stored as `<div style="page-break-after: always;"></div>`, which other
  Markdown tools understand too.
- **Callouts** are GitHub-style alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) shown as
  colored boxes in the editor and in exports (Paragraph → Callout).
- **Updates**: CaretFlow can check GitHub for a new version when it starts (it asks once; Preferences →
  Check for updates automatically, or Help → Check for Updates…). **Update & Restart** downloads the
  new version, verifies its signature, installs it and opens CaretFlow again. This works for the Windows
  installer, the AppImage, `.deb` and `.rpm`; `CaretFlow-portable.exe`, the raw binary, the Arch package
  (updated by pacman) and the `.rpm` on systems whose `rpm` only installs GPG-signed packages (Fedora 43
  and later; update with `dnf`) get a download link.
- **Command line export**, no window shown:
  `caretflow --export-pdf notes.md notes.pdf --paper letter --landscape` (also `--header`, `--footer`,
  `--author`, `--page-numbers`) and `caretflow --export-html notes.md notes.html`.

## Notes

- **Underline** (`Ctrl+U`, or the selection toolbar) is saved as `<u>text</u>`, since Markdown has no underline syntax.
- **Tables**: inserting asks for the size; press `Enter` in the last row or use the **+** buttons to grow it.
- **Mermaid**: Paragraph → Mermaid Diagram… (`Ctrl+Shift+D`) opens a template gallery.
- **Title bar**: CaretFlow draws its own (menus and window buttons in one row) on Windows and Linux.
  Settings → Use System Title Bar switches back (on Linux this applies after a restart).
- **Linux**: uses the desktop's native (xdg-portal) file dialogs, and sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` (unless you set it yourself) to avoid WebKitGTK freezes on Wayland.
- **Update checks** download only `latest.json` from GitHub, and only after you agree. No data is sent.
- **LanguageTool** sends the text being checked to the server you configure; the free public server
  allows about 20 checks a minute. Harper (the default) never sends anything.
- **Logs**: errors are written to `%TEMP%\caretflow.log` (`/tmp/caretflow.log` on Linux).

## Roadmap & Planned Features

* **Model Context Protocol (MCP) Support (Optional)**  
  Enable modular connections to custom tools, local resources, and specialized agent workflows.
* **Self-Hosted Cloud Sync (Optional)**  
  End-to-end synchronized state across devices using user-controlled storage (e.g., custom WebDAV, S3-compatible backend, or lightweight self-hosted server). No third-party lock-in.
* **Native Android Client**  
  A dedicated mobile app offering offline access, quick capture, and platform-native UI/UX.

## Made with AI

CaretFlow is written almost entirely by AI coding assistants, steered and tested by its maintainer.
**Help → About CaretFlow** shows how many lines each model wrote, counted from the git history.

Working on CaretFlow with an AI assistant? Start with [AGENTS.md](AGENTS.md): it explains the project,
its goals and conventions, and how to credit the model in commits.
