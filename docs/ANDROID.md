# CaretFlow on Android

CaretFlow runs on Android phones and tablets (Android 7 or newer). It is the same app as on the
desktop, with the same editor, writing check, themes, exports and extensions, laid out for touch.

## Install

Download `CaretFlow-X.Y.Z.apk` from the [latest release](https://github.com/Sooeeren/CaretFlow/releases/latest)
on your phone and open it. Android asks once whether your browser or file manager may install apps;
allow it. New versions install over the old one; your documents and settings stay.

CaretFlow looks for new versions on GitHub if you allow it (Preferences → General) and offers the
new APK. [Obtainium](https://github.com/ImranR98/Obtainium) can also keep it up to date.

## Your files

On the first start CaretFlow asks for **All files access**. With it, CaretFlow works on your files
like on a computer: open any folder, browse it in the file tree, search in it and sync it. Without
it, CaretFlow keeps documents in its own folder, and you can still open files that other apps hand
to it. You can turn access on later in Android's settings, or from any Open or Save dialog.

- **Open, Open Folder, Save As, exports** use CaretFlow's own file browser: Phone, Documents and
  Download are one tap away, and **Other apps…** opens a file from Google Drive or another app.
- **Documents/CaretFlow** is the default folder.
- **Open with CaretFlow**: in a file manager, open a `.md` file and pick CaretFlow. Text that another
  app shares to CaretFlow becomes a new document. Sharing several files opens the first one.
- **Saving**: auto-save is on by default on Android, because Android may close apps in the
  background at any time. When CaretFlow goes to the background, it saves the file; an unsaved new
  document is kept and comes back the next time you open CaretFlow.
- **File → Share…** sends the document to another app (mail, messengers, Drive).

## Touch layout

| | |
| --- | --- |
| ☰ (top left) | All menus, one group at a time |
| Folder button | Files, outline and folder search, as a drawer |
| Undo, redo, find, save, ⋮ | ⋮ opens the command palette with every command |
| Formatting bar | Above the keyboard while you type: bold, italic, headings, lists, quote, link, code, table, image, source mode; ⌄ hides the keyboard |
| Tap an underlined word | Spelling and grammar suggestions (on the desktop: right-click) |
| Back button | Closes menus, dialogs, drawers and the find bar first; then saves and leaves CaretFlow |

**Themes → Material You Style** matches CaretFlow to the rest of your phone: on Android 12 and newer
it takes its colors from your wallpaper.

A hardware keyboard works with all the usual shortcuts (`Ctrl+S`, `Ctrl+/`, `F7`, Vim in source mode).

## Exports and printing

- **Export as PDF** works like on the desktop, with page size, margins, header, footer and page
  numbers. The PDF opens in your PDF viewer afterwards if you like.
- **Print…** opens Android's print dialog (a printer, or Save as PDF).
- **Export as HTML** writes a single HTML file.

## What's different from the desktop

- One window: no New Window, Always on Top or title bar options.
- **Cloud Sync** works with WebDAV and S3. rclone isn't available, because an Android app can't run
  other programs.
- The **MCP server** works for AI apps on the same phone (for example in Termux); the `caretflow --mcp`
  bridge for desktop apps doesn't apply.
- Updates are new APKs instead of the in-app installer.
- The command-line exports (`--export-pdf`) are desktop-only.
