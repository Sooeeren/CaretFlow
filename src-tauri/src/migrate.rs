//! Up to 0.12.3 the desktop app's identifier was `app.folio.markdown` (from the Folio days); now it is
//! `app.caretflow.markdown`. Tauri and the WebView keep everything in folders named after it:
//! settings and recent files (the WebView's storage), window state, `secrets.json`, `mcp.json`,
//! dictionaries, the Advanced Grammar download, the sync trash. `move_old_folders` moves them to the
//! new names once, before anything opens them (plugins read their files when the app is built).
//! Android keeps the old identifier (tauri.android.conf.json): it is the package name there.

use std::fs;
use std::path::{Path, PathBuf};

pub const OLD_ID: &str = "app.folio.markdown";
pub const NEW_ID: &str = "app.caretflow.markdown";

/// The base folders Tauri puts `<identifier>` folders into, from the same `dirs` crate Tauri uses:
/// config, data, local data (the WebView's storage: EBWebView on Windows, WebKitGTK's on Linux)
/// and cache. On Windows the first two and the last two are the same folder.
pub fn base_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = [dirs::config_dir(), dirs::data_dir(), dirs::data_local_dir(), dirs::cache_dir()].into_iter().flatten().collect();
    v.dedup();
    v
}

pub fn move_old_folders() {
    for base in base_dirs() {
        if let Err(e) = move_dir(&base.join(OLD_ID), &base.join(NEW_ID)) {
            eprintln!("[caretflow] could not move {} to {NEW_ID}: {e}", base.join(OLD_ID).display());
        }
    }
}

/// Move `old` to `new` if only `old` exists. A rename is instant; if it fails (another program
/// holds a file open, or the folders are on different drives), copy what can be copied instead
/// and leave the old folder in place.
pub fn move_dir(old: &Path, new: &Path) -> std::io::Result<()> {
    if !old.is_dir() || new.exists() {
        return Ok(());
    }
    if fs::rename(old, new).is_ok() {
        return Ok(());
    }
    let r = copy_dir(old, new);
    // a half-made copy still beats starting from nothing; only an empty one is removed
    if r.is_err() && fs::read_dir(new).map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = fs::remove_dir(new);
    }
    r
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    let mut first_err = None;
    for e in fs::read_dir(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        let r = match e.file_type() {
            Ok(t) if t.is_dir() => copy_dir(&src, &dst),
            Ok(t) if t.is_file() => fs::copy(&src, &dst).map(|_| ()),
            _ => Ok(()), // symlinks and the like: not something Tauri or the WebView make here
        };
        if let Err(e) = r {
            first_err.get_or_insert(e);
        }
    }
    first_err.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caretflow-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn moves_old_folder() {
        let d = tmp("move");
        let (old, new) = (d.join(OLD_ID), d.join(NEW_ID));
        fs::create_dir_all(old.join("EBWebView")).unwrap();
        fs::write(old.join("secrets.json"), "{}").unwrap();
        move_dir(&old, &new).unwrap();
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("secrets.json")).unwrap(), "{}");
        assert!(new.join("EBWebView").is_dir());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn keeps_existing_new_folder() {
        let d = tmp("keep");
        let (old, new) = (d.join(OLD_ID), d.join(NEW_ID));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a"), "old").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("a"), "new").unwrap();
        move_dir(&old, &new).unwrap();
        assert_eq!(fs::read_to_string(new.join("a")).unwrap(), "new");
        assert!(old.exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn copy_fallback() {
        let d = tmp("copy");
        let (old, new) = (d.join("from"), d.join("to"));
        fs::create_dir_all(old.join("sub")).unwrap();
        fs::write(old.join("sub/b"), "x").unwrap();
        copy_dir(&old, &new).unwrap();
        assert_eq!(fs::read_to_string(new.join("sub/b")).unwrap(), "x");
        fs::remove_dir_all(&d).unwrap();
    }
}
