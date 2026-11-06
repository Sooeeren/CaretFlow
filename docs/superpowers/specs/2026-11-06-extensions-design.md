# Extensions page: design

Status: draft for approval · 2026-11-06 · ships in the same release as
[AI writing help](2026-11-06-ai-assist-design.md), which becomes the third extension.

## Intent

Keep CaretFlow light for people who only want to write, and let others add bigger features with
one click. The weight that matters is clutter (menus, Preferences tabs, sidebar tabs, status-bar
buttons) more than download size: the optional features already load lazily and add little to the
installer. So the extensions ship inside the app, and an extension that isn't installed is
**completely absent**: no UI, no settings page, no shortcuts, its code never loaded.

## Goals

- An **Extensions** page that looks and feels like a small store: cards with an icon, name, one-line
  description and an **Install** / **Remove** button; a detail view with screenshots to flip
  through, a longer description, what it adds, and what it sends over the network.
- First extensions:
  - **Cloud Sync** (exists, moves here)
  - **Typing Test** (exists, moves here; the typing cat and the WPM meter stay in the core app)
  - **AI Writing Help** (new, per its design)
- Install and Remove work instantly: no restart, no download, no network.
- Removing keeps the extension's settings and data (Cloud Sync state, typing-test personal bests,
  AI usage), so reinstalling picks up where it left off.

## Non-goals

- No downloadable third-party plugins, plugin API, signing or hosted store in this release. The
  page is built so such entries could be added later, but nothing is designed for that now.
- No paid extensions.

## Behaviour

### Opening the page

- **Settings → Extensions…**, the command palette ("Extensions"), and a line at the top of
  Preferences ("More features: Extensions…"). Default shortcut: none.
- A large overlay page in the app window (like Preferences, wider), closable with Esc. Works in all
  four themes and at small window sizes (cards wrap to one column).

### Cards and details

- Grid of cards: icon, name, one line, a small "Installed" badge, and the Install/Remove button.
- Click a card (not the button) → detail view: 2–3 screenshots with ← → and dots, the description,
  **What it adds** (e.g. "Cloud tab in the sidebar, File → Sync Now (Ctrl+Alt+S), a status-bar
  button, Preferences → Cloud Sync"), **Network** ("Only to the server you set up" / "None" /
  "Only to the AI provider you choose, or local MCP clients"), size note, Install/Remove.
- After Install: a toast plus a button in the detail view to open the extension's settings page
  (Cloud Sync, AI) or start it (Typing Test).
- Remove asks for confirmation when the extension is active (e.g. Cloud Sync is turned on: "Sync
  stops; your files stay where they are").

### What "not installed" removes

| Extension | Removed when not installed |
| --- | --- |
| Cloud Sync | File → Sync Now, View → Cloud Files, Settings → Cloud Sync…, the Cloud sidebar tab, the status-bar button, Preferences → Cloud Sync, automatic syncs and timers, `Ctrl+Alt+S` / `Ctrl+Shift+4` |
| Typing Test | View → Typing Test…, `Ctrl+Alt+T`, its palette entry |
| AI Writing Help | Preferences → AI, the AI tab in the F7 panel, AI underlines, Edit → AI commands, Help → AI Setup Guide, the MCP server, its shortcuts |

Menus, the command palette, `Shift+F1`, Preferences → Keyboard and the custom shortcut list all
skip commands of extensions that aren't installed. Custom shortcuts the user set for them are kept
and come back on reinstall.

### Screenshots

Bundled with the app as small images (WebP, ~1280 px wide, aiming for well under 100 KB each), made
by the screenshot script, so opening the page never uses the network.

### Defaults and updating from 0.7.0

- New installs: no extensions installed.
- Updating: **Cloud Sync stays installed if it was turned on**; otherwise nothing is installed.
  The typing test is not installed after the update for anyone; its personal bests are kept.
  The first start after the update shows a one-time notice: "Typing Test and Cloud Sync are now
  extensions: Settings → Extensions…" (only for users updating, not new installs).

### Storage

`settings.extensions` (in `DEFAULTS`): a list of installed extension ids. Each extension declares
its id, name, texts, screenshots, the menu items/commands it owns, its Preferences page, its
sidebar tab and status-bar element, and its `activate()` / `deactivate()` hooks (start/stop timers,
the MCP server, underlines). The core asks "is X installed" in one place.

## Docs

- README: the Typing Test section and its screenshots leave the main README (details move to
  `docs/FEATURES.md`). A short **Extensions** section lists the three with one line each and how to
  install them. The Cloud Sync section shrinks to that line plus the link to `docs/CLOUD-SYNC.md`.
- `docs/EXTENSIONS.md`: the page, each extension, what installing/removing does.
- `src/guide.md`, `src/welcome.md` (mention Settings → Extensions), `docs/SHORTCUTS.md` (mark
  extension shortcuts), AGENTS.md (how to add an extension).

## Calls I made (check these)

- The page is an overlay inside the main window, not a separate window.
- Screenshots are bundled, not fetched from GitHub.
- A one-time notice tells updating users where the typing test and Cloud Sync went.
- Custom shortcuts for removed extensions are kept for a later reinstall.
