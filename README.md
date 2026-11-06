# CaretFlow

<img src="src-tauri/icons/128x128@2x.png" width="96" align="right" alt="">

**A fast, quiet Markdown editor for Windows and Linux.** You write, CaretFlow renders it in place:
no split preview, no clutter. Raw Markdown and Vim are one shortcut away, and a built-in spelling
and grammar checker catches mistakes as you type.

![CaretFlow editing a Markdown file with the file sidebar open](docs/screenshots/hero.png)

<p align="center">
  <a href="https://github.com/Sooeeren/CaretFlow/releases/latest"><b>Download the latest release</b></a> ·
  <a href="#install">Install</a> ·
  <a href="docs/SHORTCUTS.md">Shortcuts</a> ·
  <a href="#documentation">Documentation</a>
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
- **Private by default**: no telemetry, and no network access unless you turn on LanguageTool, update
  checks or Cloud Sync.

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
- **Cloud Sync (optional)** with your own server or storage: WebDAV (Nextcloud, NAS…), S3, or Google
  Drive and Proton Drive through rclone.
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

The checker is [Harper](https://writewithharper.com), which runs on your computer (English), or
optionally [LanguageTool](https://languagetool.org) for 30+ more languages. More in
[docs/FEATURES.md](docs/FEATURES.md#writing-check).

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

`Ctrl+Alt+T` opens a minimal speed test, by time or by word count, or on the text of the document
you have open. Results show WPM, accuracy, consistency and a per-second chart.

<table>
  <tr>
    <td><img src="docs/screenshots/typing.png" alt="Typing test in progress"></td>
    <td><img src="docs/screenshots/results.png" alt="Typing test results with chart"></td>
  </tr>
</table>

While writing, **View → Typing Speed (WPM)** shows your speed in the status bar and
**View → Typing Cat** adds a small companion that taps along. Both are off by default.

![The typing cat in the corner and the WPM meter in the status bar](docs/screenshots/bongo.png)

## Cloud Sync

Keep a folder in sync between computers with storage **you** choose. CaretFlow has no servers or
accounts of its own, and Cloud Sync stays off until you turn it on in Preferences → Cloud Sync.

- **WebDAV**: Nextcloud, ownCloud, Synology/QNAP, pCloud, Koofr and any WebDAV server
- **S3-compatible**: AWS, Backblaze B2, Cloudflare R2, Wasabi, MinIO
- **Google Drive, Proton Drive, OneDrive, Dropbox** and more through your own [rclone](https://rclone.org) remotes

Changes go both ways; conflicts keep both versions, files a sync removes land in a sync trash, and
CaretFlow asks before deleting many files at once. The **Cloud** tab in the sidebar (`Ctrl+Shift+4`)
lists every file in the cloud by folder, with its sync state. Setup for each service:
[docs/CLOUD-SYNC.md](docs/CLOUD-SYNC.md).

![The Cloud tab: files in the cloud by folder, with their sync state](docs/screenshots/cloud.png)

## Documentation

| | |
| --- | --- |
| [Keyboard shortcuts](docs/SHORTCUTS.md) | Every default shortcut, by menu |
| [Features in detail](docs/FEATURES.md) | Writing check, Vim, PDF export and preview, callouts, updates, command line |
| [Cloud Sync](docs/CLOUD-SYNC.md) | Setting up WebDAV, S3 and rclone; how syncing works |
| [Notes](docs/NOTES.md) | Privacy and network access, platform notes, where files are stored |
| [Building](docs/BUILDING.md) · [Releasing](docs/RELEASING.md) | For developers |

In the app, **Help → Markdown Guide** shows the Markdown syntax and **Shift+F1** all shortcuts.

## Roadmap & Planned Features

* **Model Context Protocol (MCP) Support (Optional)**  
  Enable modular connections to custom tools, local resources, and specialized agent workflows.
* **Native Android Client**  
  A dedicated mobile app offering offline access, quick capture, and platform-native UI/UX.

## Made with AI

CaretFlow is written almost entirely by AI coding assistants, steered and tested by its maintainer.
**Help → About CaretFlow** shows how many lines each model wrote, counted from the git history.

Working on CaretFlow with an AI assistant? Start with [AGENTS.md](AGENTS.md): it explains the project,
its goals and conventions, and how to credit the model in commits.
