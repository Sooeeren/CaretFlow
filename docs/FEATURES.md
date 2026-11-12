# Features in detail

The [README](../README.md) gives the overview; this page has the details. For shortcuts see
[SHORTCUTS.md](SHORTCUTS.md); for the extensions [EXTENSIONS.md](EXTENSIONS.md),
[CLOUD-SYNC.md](CLOUD-SYNC.md) and [AI.md](AI.md).

## Writing check

CaretFlow checks spelling and grammar as you type. Red wavy lines mark spelling, blue double lines
grammar (*their/they're*, *could of*, *a apple*, *I has*, repeated words), and amber dotted lines
optional style hints. Right-click a marked word to fix it, ignore it or add it to your dictionary.
`F7` walks through every issue in a review panel; a clean document shows readability statistics.

| | |
| --- | --- |
| **Checker** | [Harper](https://writewithharper.com) by default: runs locally (WebAssembly), English in American, British, Canadian, Australian or Indian spelling. [LanguageTool](https://languagetool.org) optionally, for grammar in German, French, Spanish and 30+ more languages: the public server, Premium, Docker or the **Advanced Grammar** extension on this computer ([LANGUAGETOOL.md](LANGUAGETOOL.md)). |
| **Other languages** | With Harper, each paragraph is checked in its own language. A German, French, Spanish… paragraph is never marked as English mistakes; CaretFlow offers that language's spelling dictionary (Hunspell, the one LibreOffice uses, 1–9 MB) and checks it offline from then on. 17 dictionaries, including German for Austria and Switzerland, in Preferences → Writing → Other languages. `lang: de` in the front matter sets a document's main language. |
| **Your words** | The custom dictionary (Preferences → Writing) also feeds Harper's suggestions. A word added in lowercase allows *word*, *Word* and *WORD*; one with capitals (*CaretFlow*) only itself and all caps. Per folder: a `.caretflow-words` file (one word per line, `#` for comments) in the document's folder or any folder above it up to the open folder; the right-click menu's **Add to Folder Word List** writes it. Per document: `spellcheck-words: [word, other]` in the front matter. **Ignore All** is remembered per file. |
| **Shortcuts** | `F7` review panel · `Alt+F7` next issue · right-click for suggestions |
| **AutoCorrect** | Fixes common typos while you type (*teh* → *the*, *dont* → *don't*, *i* → *I*). `Backspace` right after a fix undoes it. |
| **Markdown-aware** | Code, inline code, math, links and file names are skipped, in both the rendered and the source view. |
| **Settings** | Preferences → Writing: engine, language, LanguageTool server and Premium login, style hints, custom dictionary, other languages, rules you turned off. |
| **AI** | The AI Writing Help extension adds findings from the AI you choose, in the same menu and in an AI tab of the review panel ([AI.md](AI.md)). |

## Vim mode

`Ctrl+Alt+V` turns on Vim keys for source mode (`Ctrl+/`): normal, insert, visual and visual-block
modes, motions, operators, registers, marks, macros, `/` search, `:s`, and commands like `:w`, `:q`,
`:e` and `:pre` (back to the rendered view). `Ctrl+A` / `Ctrl+X` and `g Ctrl+A` work on selections.
Turn on **Open Files in Source Mode** to always edit that way. Vim mode shows line numbers
(optionally relative, like `:set relativenumber`; without Vim, every fifth line can be numbered:
View → Line Numbers), and CaretFlow starts in source mode again when you quit there.

## PDF export and page preview

- **Export as PDF** (`Ctrl+Alt+E`) writes the file directly, no print dialog: paper size, orientation,
  margins, page numbers, header and footer (`{title}` `{file}` `{date}` `{author}`) and document
  properties. **File → Print…** still opens the system dialog.
- **Page preview** (`Ctrl+Alt+L`) shows the real PDF next to the editor, refreshed as you type.
- **Page breaks** (`Ctrl+Enter`) are stored as `<div style="page-break-after: always;"></div>`,
  which other Markdown tools understand too.
- **Command line**, no window shown:
  `caretflow --export-pdf notes.md notes.pdf --paper letter --landscape` (also `--header`,
  `--footer`, `--author`, `--page-numbers`) and `caretflow --export-html notes.md notes.html`.

## Blocks and formatting

- **Sub-points** (nested lists) get hollow or square bullets, lettered or roman numbers, a softer
  marker color and slightly smaller text. Turn it off in Preferences → Editing → Style sub-points
  differently.
- **Front matter** (the `---` YAML block at the top of a file, used by Jekyll, Hugo, Obsidian and
  Pandoc; TOML `+++` too) shows as a properties panel: keys on the left, lists as chips. Click it, or
  press `Enter` when it is selected, to edit the YAML; `Ctrl+Enter` or clicking elsewhere finishes,
  `Escape` cancels. Insert → Front Matter (`Ctrl+Alt+F`) adds one. It is left out of exports.
- **Table of contents**: a line with just `[TOC]` (as in Typora and GitLab) shows the document's
  headings as a list that follows your edits; a click goes to the heading. Exports turn it into
  links and give every heading a GitHub-style id. Insert → Table of Contents (`Ctrl+Alt+O`).
- **Callouts** are GitHub-style alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) shown
  as colored boxes in the editor and in exports (Paragraph → Callout).
- **Underline** (`Ctrl+U`, or the selection toolbar) is saved as `<u>text</u>`, since Markdown has no
  underline syntax.
- **Tables**: inserting asks for the size; press `Enter` in the last row or use the **+** buttons to
  grow it.
- **Mermaid**: Insert → Mermaid Diagram… (`Ctrl+Shift+D`) opens a template gallery.
- **Math** is rendered with KaTeX, inline (`Ctrl+Shift+E`) or as a block (`Ctrl+Shift+M`).
- **HTML** (README headers, `<kbd>`, `<sub>`, `<details>`, `<img width=…>`) is shown rendered. Click
  it, or press `Enter` when it is selected, to edit the HTML; `Ctrl+Enter` or clicking elsewhere
  finishes, `Escape` cancels. Scripts, event handlers, forms and frames are removed before showing,
  and the file keeps the HTML exactly as written.

## Files and folders

The sidebar has an outline, a file tree and folder search; with Cloud Sync on, a **Cloud** tab too.
`Ctrl+P` jumps to any file in the open folder. Pasted or dropped images are copied into an `assets`
folder next to the document (Preferences → Editing).

## Typing test and extras

The typing test is an extension: install it in Preferences → Extensions. Then `Ctrl+Alt+T` opens a minimal speed test: 15 to 120 seconds or 10 to 100 words, with optional
punctuation and numbers, or practice on the text of the document you have open. Results show WPM,
accuracy, raw speed, consistency and a per-second chart, and personal bests are kept.

While writing, **Tools → Typing Speed (WPM)** shows your speed in the status bar and
**Tools → Typing Cat** adds a small companion that taps along. Both are off by default.

## Material You style

**View → Theme → Material You Style** (off by default) gives CaretFlow the look of Material 3: rounded
dialogs and menus, pill-shaped buttons and tabs, and a color scheme made from one color. The theme
still decides light or dark (Paper and Sepia are light, Ink and Slate dark, Follow System follows
the system) and the document font. Pick the color in **Preferences → Appearance → Material color**:
eight swatches or any `#rrggbb`. On Android 12 and newer the first swatch follows your wallpaper,
like other Material You apps. Exports with the "Same as editor" theme use the Material colors too.

## Updates

CaretFlow can check GitHub for a new version when it starts (it asks once; Preferences → Check for
updates automatically, or Help → Check for Updates…). **Update & Restart** downloads the new version,
verifies its signature, installs it and opens CaretFlow again. This works for the Windows installer,
the AppImage, `.deb` and `.rpm`. `CaretFlow-portable.exe`, the raw binary, the Arch package (updated
by pacman) and the `.rpm` on systems whose `rpm` only installs GPG-signed packages (Fedora 43 and
later; update with `dnf`) get a download link instead.

## Discord Status

The Discord Status extension shows on your Discord profile that you are writing in CaretFlow: the
CaretFlow logo, **Writing** or **Reading** (after 15 minutes away, **Idle**), the word count,
source mode or Vim, how long you have been on the document, and a **Get CaretFlow** button.
The file name is not shown unless you turn it on.

Install it in Preferences → Extensions. **Preferences → Discord** shows a preview of your status and
lets you choose each part; **Tools → Discord Status** hides or shows it. CaretFlow talks only to the
Discord app on your computer (no network of its own), so Discord must be running, with
*Share your detected activities* on under Settings → Activity Privacy. It works with the Discord
app on Windows and Linux (also Flatpak and Snap), not on Android.
