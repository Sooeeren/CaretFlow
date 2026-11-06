# Notes

Details that are good to know, but not needed to get started.

## Privacy and network access

CaretFlow sends nothing anywhere unless you turn something on. There is no telemetry.

- **Update checks** download only `latest.json` from GitHub, and only after you agree. No data is sent.
- **LanguageTool** sends the text being checked to the server you configure; the free public server
  allows about 20 checks a minute. Harper (the default checker) never sends anything.
- **Cloud Sync** uploads the files in your sync folder to the server or storage you set up, and nowhere
  else. CaretFlow has no servers of its own. Passwords and keys are stored in `secrets.json` in
  CaretFlow's config folder, readable only by your user. See [CLOUD-SYNC.md](CLOUD-SYNC.md).

## Platforms

- **Title bar**: CaretFlow draws its own (menus and window buttons in one row) on Windows and Linux.
  Settings → Use System Title Bar switches back (on Linux this applies after a restart).
- **Linux**: uses the desktop's native (xdg-portal) file dialogs, and sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` (unless you set it yourself) to avoid WebKitGTK freezes on
  Wayland. CaretFlow draws the text cursor itself there, because WebKitGTK can leave stale copies of
  it behind (Preferences → Editing → Draw the text cursor).
- **macOS**: there is no build and none is planned right now, but it is not ruled out. Tauri supports
  macOS, so it depends on someone being able to build and test it.

## Where things are stored

| What | Where |
| --- | --- |
| Settings, recent files, window state | The app's web storage and config folder (`app.folio.markdown`, the name from before the rename) |
| Cloud Sync passwords and keys | `secrets.json` in the config folder (`%APPDATA%\app.folio.markdown` on Windows, `~/.config/app.folio.markdown` on Linux) |
| Cloud Sync trash | `sync-trash` in the data folder (`%APPDATA%\app.folio.markdown`, `~/.local/share/app.folio.markdown`); also Cloud tab → Sync trash |
| Logs | `%TEMP%\caretflow.log` (`/tmp/caretflow.log` on Linux), errors only |

## The name

CaretFlow was called **Folio** until 0.5.0. Updating keeps your settings; the Windows installer
removes the old Folio install.
