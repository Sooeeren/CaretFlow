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

- **Scrolling**: `Ctrl+E` / `Ctrl+Y` scroll the text line by line, `Ctrl+D` / `Ctrl+U` by half a page,
  `Ctrl+F` / `Ctrl+B` by a page; `zz`, `zt` and `zb` put the cursor's line in the middle, at the top or
  at the bottom.
- **`:Explore`** (or `:Ex`) opens the file tree and moves the keyboard there: `j` / `k` go down and up,
  `l` or `Enter` opens a folder or a file, `h` closes a folder or goes to the one a file is in, `gg` /
  `G` jump to the first and last row. `Escape` goes back to the text; `:Explore` again closes the
  tree. These keys only work in a tree that was opened with `:Explore`.
- **Messages** in the command line are red only when something failed.
- **The cursor keeps its place** when you switch between the rendered view and source mode (`Ctrl+/`,
  `:pre`), with or without Vim: the same word, at the same height in the window.

## PDF export and page preview

- **Export as PDF** (`Ctrl+Alt+E`) writes the file directly, no print dialog: paper size, orientation,
  margins, page numbers, header and footer (`{title}` `{file}` `{date}` `{author}`) and document
  properties. **File → Print…** still opens the system dialog.
- **Page preview** (`Ctrl+Alt+L`) shows the real PDF next to the editor, refreshed as you type.
- **Same layout as the editor.** PDFs, the page preview, printing and HTML exports use the editor's
  spacing: paragraphs, list items and sub-points, quotes, callouts, code blocks, tables and rules sit
  where they do while you write.
- **Page breaks** (`Ctrl+Enter`) are stored as `<div style="page-break-after: always;"></div>`,
  which other Markdown tools understand too.
- **Command line**, no window shown:
  `caretflow --export-pdf notes.md notes.pdf --paper letter --landscape` (also `--header`,
  `--footer`, `--author`, `--page-numbers`) and `caretflow --export-html notes.md notes.html`.

## Word, OpenDocument, EPUB, LaTeX and plain text

**File → Export as Other Format** has Word (.docx, `Ctrl+Alt+W`), HTML, OpenDocument, EPUB, LaTeX
and plain text; they write the document for other programs. Everything is made inside CaretFlow, offline; web images are left out
as links.

- **Word (.docx)** uses Word's own styles (Title, Heading 1–6, Quote, lists, a table style), so the
  navigation pane, a table of contents and restyling work. Math becomes real, editable Word
  equations; code keeps its colors; callouts are colored boxes; images and Mermaid diagrams are
  embedded. Paper size, margins, header, footer and page numbers come from the PDF page settings.
- **OpenDocument (.odt)** for LibreOffice, OnlyOffice and Google Docs, with the same layout and page
  settings. Math is kept as TeX text there; use .docx when you need equations.
- **EPUB (.epub)** e-books: a chapter per top-level heading, a table of contents, images packed in,
  math as MathML and diagrams as SVG.
- **LaTeX (.tex)** for journals and theses: sections, lists, `longtable` tables, math as written and
  images referenced from where they are. Compiles with pdfLaTeX, XeLaTeX and LuaLaTeX.
- **Plain text (.txt)** without Markdown marks: underlined headings, aligned tables, link addresses
  in brackets.

Front matter fills in the title, author and date (a title page in Word, OpenDocument and EPUB) and
the document properties. On the command line: `caretflow --export-docx notes.md notes.docx`, and
likewise `--export-odt`, `--export-epub`, `--export-tex`, `--export-txt` (with the same `--paper`,
`--landscape`, `--header`, `--footer`, `--author` and `--page-numbers` options as PDFs).

## Blocks and formatting

- **Footnotes** (`[^1]` and `[^1]: …`) are numbered in the order they appear, also named ones
  (`[^note]`), with the notes below a rule; a click on a number goes to its note and back.
  Exports number them the same way and list the notes at the end.
- **Links**: `Ctrl+Click` opens a link, and so does a click on the address in the popup that shows
  when the cursor is in a link.
- **Sub-points** (nested lists) get hollow or square bullets, lettered or roman numbers, a softer
  marker color and slightly smaller text. Turn it off in Preferences → Editing → Style sub-points
  differently.
- **Code blocks** wrap long lines onto the next line instead of scrolling sideways, in the editor
  and in exports (PDF, HTML, print). Turn it off with View → Wrap Code Lines (`Alt+Z`) or
  Preferences → Editing → Wrap long code lines. The language button and Copy sit beside the first
  line and never over code: a first line too long for that (with wrapping off) moves them into a
  row of their own.
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
- **Mermaid**: Insert → Mermaid Diagram… (`Ctrl+Shift+D`) opens a template gallery. With the
  [Diagram Editor](#diagram-editor) extension, diagrams can also be drawn.
- **Math** is rendered with KaTeX, inline (`Ctrl+Shift+E`) or as a block (`Ctrl+Shift+M`).
- **Pasting** (Edit menu or right-click): **Paste** (`Ctrl+V`) keeps links and formatting;
  **Paste as Plain Text** (`Ctrl+Shift+V`) puts in only the text, without links, bold, headings or
  lists, and leaves Markdown characters as they are; **Paste as Markdown** (`Ctrl+Alt+Shift+V`)
  reads the copied text as Markdown, even when it came from an editor that adds colored HTML. In
  source mode, Paste as Markdown turns text copied from a web page into Markdown, links included.
- **HTML** (README headers, `<kbd>`, `<sub>`, `<details>`, `<img width=…>`) is shown rendered.
  Markdown between a `<div align="center">` line and its `</div>` line (or `<center>`, or a wrapper
  with a `style="text-align: …; color: …"`) shows centered or styled and stays editable Markdown; the
  two tag lines are hidden (source mode shows them). `<details><summary>…</summary>` … `</details>` around Markdown opens and closes with a click
  on the summary (a double click edits it). Click
  it, or press `Enter` when it is selected, to edit the HTML; `Ctrl+Enter` or clicking elsewhere
  finishes, `Escape` cancels. Scripts, event handlers, forms and frames are removed before showing,
  and the file keeps the HTML exactly as written.

## Files and folders

The sidebar has an outline, a file tree and folder search; with Cloud Sync on, a **Cloud** tab too.
`Ctrl+P` jumps to any file in the open folder.

What happens to a pasted, dropped or inserted image is up to you (Preferences → Editing, or
Insert → When Adding Images): copy it to `./assets`, to `./<file name>.assets`, or to a custom
folder (next to the document or a full path; `${filename}` stands for the document's name), keep
its original path, or embed it in the document as Base64. Two switches go with it: copy images that
already sit in the document's folder too, and start relative paths with `./`. Untitled documents
embed images until they are saved.

An image that can't be loaded shows a small box with its path instead of an empty gap.

Hover an image for its **full-screen** button (or right-click → View Full Screen): the image fills
the screen, the arrow keys go through the document's images, and `Esc` closes it. An image's
caption (its alt text) stays hidden until you edit it with the caption button or right-click →
Edit Alt Text; **View → Show Image Alt Text** (Preferences → Editing) shows it under every image.

Right-click an image to resize it (10 % to
200 % or any size you type; Format → Image Size and `Ctrl+Alt+=` / `Ctrl+Alt+-` / `Ctrl+Alt+0` do
the same for the clicked image). The size is saved as `<img … style="zoom:50%;" />` like Typora
does, and PDF, HTML, Word, OpenDocument and LaTeX exports use it. **Custom Size…** takes a percentage
or a width in pixels (it shows the image's own size), saved as `<img … width="300" />`, which GitHub
shows at that size too.

## Your own menus

**Help → Customize Menus…** (or Preferences → Menus) shows the menu bar as a tree next to a list of
every command. Drag commands from the list into a menu, and drag them back to the list to take them
out. **New Menu** adds a menu to the menu bar, **New Submenu** one inside the selected menu, and
**Separator** a line; double-click a menu (or press `F2`) to rename it. Menus and submenus move like
commands: drag one into another to nest it. With the keyboard, `Alt+↑` / `Alt+↓` move the selected
row, `Alt+←` takes it out of its menu, `Alt+→` puts it into the menu above, `Delete` removes it and
`Ctrl+Z` undoes. **Templates…** starts from menus made for a kind of work (also in Preferences →
Menus → Start from a template):

| Template | Menus | Made for |
| --- | --- | --- |
| Minimal | File · Edit · View · Help | The commands most people use; the rest is in the command palette |
| Writer | File · Edit · Format · Review · View · Help | Stories, essays, blogs: focus/typewriter/zen modes, the writing check and AI in a Review menu, Word and EPUB export |
| Student & Academic | File · Edit · Paragraph · Insert · Format · Export · Review · View · Help | Papers and theses: math, tables, table of contents, page breaks, an Export menu with PDF, Word and LaTeX |
| Developer & Technical Writer | File · Edit · Insert · Format · View · Tools · Help | READMEs and docs: source mode, Vim and line numbers, code and diagrams, front matter, copy as Markdown/HTML |
| Note-taker | Notes · Edit · Insert · Format · View · Help | A folder of notes: quick open, folder search, task lists, callouts, sidebar tabs, Cloud Sync |

A template opens in the editor, so you can change it before saving; Undo brings your menus back.
Every template keeps Preferences… and Customize Menus…. A command that is in no menu still works with its shortcut and from the command
palette (`F1`). **Reset to Default** brings back the menus CaretFlow comes with. Commands added by a
later version show up next to where they are in the default menus. On Android the menu drawer shows
the same menus. In a narrow window the window buttons always stay visible: menus that don't fit move
into a **»** menu at the end of the menu bar.

## Typing test and extras

The typing test is an extension: install it in Preferences → Extensions. Then `Ctrl+Alt+T` opens a minimal speed test: 15 to 120 seconds or 10 to 100 words, with optional
punctuation and numbers, or practice on the text of the document you have open. Results show WPM,
accuracy, raw speed, consistency and a per-second chart, and personal bests are kept.

While writing, **Tools → Typing Speed (WPM)** shows your speed in the status bar and
**Tools → Typing Cat** adds a small companion that taps along. Both are off by default. The cat
comes in eight styles: Classic, Midnight, Ginger Tabby, Russian Blue, Calico, Siamese, Tuxedo and
Cookie. Pick one under **Tools → Cat Style** or in **Preferences → Typing**, where each is shown.
**Make Your Own Cat…** (same places) opens an editor with a big preview: colors for the fur, outline,
ears, eyes, mouth, paws and markings, which markings it has (stripes, patches, a mask, a bib) and
blush. Start from any of the eight styles; your cat is then the **Your Own** style.

## Custom themes

**View → Theme → New Custom Theme…** makes a theme of your own, starting from the colors you use
now. Set the background, text, headings, secondary text, accent, links, sidebar, panels, borders,
code, quote bar and selection with a color picker or as `#rrggbb`, and the document font; a preview
shows the result before you save. A dark background makes it a dark theme, so code colors, diagrams
and the title bar follow. Your themes are listed under **View → Theme → Custom Themes** and in
**Preferences → Appearance**, where you can also edit or delete them. Material You and Custom CSS
still apply on top, and exports use a custom theme when the export theme is "Same as editor".

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

## Diagram Editor

An extension (Preferences → Extensions) for Mermaid diagrams. Insert → Edit Diagram… (`Ctrl+Alt+D`)
opens the diagram at the cursor, or a new one outside a diagram; in the rendered view every Mermaid
block also gets a **Diagram** button, and double-clicking a drawing opens it. Templates from
Insert → Mermaid Diagram… open in the editor too.

The code is on the left and the drawing on the right; both stay in step. **Flowcharts** can be edited
on the drawing:

- **+ Box** (or `A`, or double-click on empty space) adds a box; with a box selected, the new one is
  linked from it, so a chain is quick to build.
- **Drag** from one box to another to connect them.
- **Double-click** a box or a link (or `F2` / `Enter`) to rename it; links get a text that way.
- The toolbar sets the **shape** of the selected box (box, rounded, pill, circle, decision, database,
  hexagon, …), the **style** of the selected link (arrow, line, dotted, thick, both ways) and the
  **direction** of the whole chart.
- `Del` deletes the selection, `Ctrl+Z` / `Ctrl+Y` undo and redo, `Esc` cancels, `Ctrl+Enter` (or
  **Done**) puts the diagram into the document.

Mermaid places everything by itself, so boxes can't be moved by hand; the editor changes what is
connected, not where it sits. The result is ordinary Mermaid code, readable in any other tool;
`style`, `classDef` and comment lines are kept. Flowcharts with subgraphs, and all other diagram
types (sequence, class, Gantt, …), are edited as code with a live drawing.

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

## Preferences search

Preferences (`Ctrl+,`) opens with a search field above its categories: type a word and every
setting that mentions it shows, from all pages at once, with the Keyboard page filtered to the
matching commands. `Esc` clears the search; clicking a category goes back to browsing.
