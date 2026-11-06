# Extensions

CaretFlow keeps bigger, optional features out of the way until you want them. They come with the
app, so installing one needs no download: **Preferences → Extensions** (also **Settings →
Extensions…** and the command palette) shows each one as a card. Click **Install**, or click the
card for screenshots, what it adds and what it sends over the network.

An extension that isn't installed is completely absent: no menu items, shortcuts, sidebar tab,
status-bar button or Preferences page, and its code is never loaded. **Remove** takes it all away
again; if it is in use (Cloud Sync turned on, a typing test open), CaretFlow asks first. Its settings
are kept, so installing it again picks up where you left off, including custom shortcuts you gave
its commands.

## The extensions

| | Adds | Network |
| --- | --- | --- |
| **Cloud Sync** ([guide](CLOUD-SYNC.md)) | Cloud tab in the sidebar (`Ctrl+Shift+4`), File → Sync Now (`Ctrl+Alt+S`), a sync button in the status bar, Preferences → Cloud Sync | Only to the server or storage you set up, once you turn it on |
| **AI Writing Help** ([guide](AI.md), [MCP](MCP.md)) | Preferences → AI, the AI tab in the review panel (`F7`), AI underlines, Edit → AI commands (`Ctrl+Alt+K`, `Shift+Alt+F7`), Help → AI Setup Guide, a local MCP server | Only to the AI provider you choose, or to AI apps on this computer over MCP |
| **Typing Test** ([details](FEATURES.md#typing-test-and-extras)) | View → Typing Test… (`Ctrl+Alt+T`) | None |

The typing cat and the WPM meter are part of CaretFlow itself (View menu).

## Updating from 0.7.0

Before 0.8.0, Cloud Sync and the typing test were built in. After updating:

- Cloud Sync stays installed if you had turned it on; otherwise install it again.
- The typing test is not installed; install it again and your personal bests are still there.

CaretFlow shows a one-time note about this after the update.
