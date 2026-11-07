//! Android: the bridge to CaretFlowPlugin.kt (gen/android/app/src/main/java/app/folio/markdown).
//! Files that other apps hand to CaretFlow arrive as `content://` links instead of paths, so the
//! file commands in lib.rs send those here and the plugin reads and writes them through Android.
//! Everything else (storage permission, "Open with", share, print, PDF) is a plugin call too.
//! The frontend only calls the `android_*` commands below, never the plugin directly.

use base64::Engine;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Wry};

static HANDLE: OnceLock<PluginHandle<Wry>> = OnceLock::new();
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("caretflow")
        .setup(|app, api| {
            let h = api.register_android_plugin("app.folio.markdown", "CaretFlowPlugin")?;
            let _ = HANDLE.set(h);
            // std::env::temp_dir() is /data/local/tmp on Android, which apps can't write to;
            // point it at the app's cache folder so exports, the page preview and logs work
            if let Ok(dir) = app.path().app_cache_dir() {
                let _ = std::fs::create_dir_all(&dir);
                std::env::set_var("TMPDIR", &dir);
            }
            Ok(())
        })
        .build()
}

fn call<T: DeserializeOwned>(cmd: &str, args: Value) -> Result<T, String> {
    HANDLE
        .get()
        .ok_or("the Android plugin is not loaded")?
        .run_mobile_plugin::<T>(cmd, args)
        .map_err(|e| e.to_string())
}

pub fn is_uri(p: &str) -> bool {
    p.starts_with("content://")
}

// ── content:// files (used by the file commands in lib.rs)
pub fn read_uri(uri: &str) -> Result<Vec<u8>, String> {
    let v: Value = call("readUri", json!({ "uri": uri }))?;
    B64.decode(v["data"].as_str().unwrap_or_default()).map_err(|e| e.to_string())
}

pub fn write_uri(uri: &str, data: &[u8]) -> Result<(), String> {
    call::<Value>("writeUri", json!({ "uri": uri, "data": B64.encode(data) })).map(|_| ())
}

/// { exists, mtime, name } of a content:// file
pub fn uri_info(uri: &str) -> Value {
    call::<Value>("uriInfo", json!({ "uri": uri })).unwrap_or(Value::Null)
}

/// Render the HTML file `html` to a PDF at `out` with Android's print engine.
pub fn print_pdf(html: &str, out: &str, w_mm: f64, h_mm: f64, margin_mm: f64) -> Result<(), String> {
    call::<Value>(
        "printPdf",
        json!({ "html": html, "out": out, "widthMm": w_mm, "heightMm": h_mm, "marginMm": margin_mm }),
    )
    .map(|_| ())
}

// ── commands for the frontend (src/android.js)

/// { granted, sdk } — "All files access" (Android 11+) or the storage permission (older)
#[tauri::command]
pub async fn android_storage() -> Result<Value, String> {
    call("storageStatus", json!({}))
}

/// Opens the system page where the user turns on "All files access" (asks, before Android 11).
#[tauri::command]
pub async fn android_request_storage() -> Result<(), String> {
    call::<Value>("requestStorage", json!({})).map(|_| ())
}

/// { path, name } for a content:// link: a real path when Android has one (null otherwise)
#[tauri::command]
pub async fn android_resolve(uri: String) -> Value {
    call::<Value>("resolveUri", json!({ "uri": uri })).unwrap_or(Value::Null)
}

/// Copy a content:// file (an image from the gallery) to a real path.
#[tauri::command]
pub async fn android_copy_uri(uri: String, to: String) -> Result<(), String> {
    let data = read_uri(&uri)?;
    let p = std::path::Path::new(&to);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, data).map_err(|e| e.to_string())
}

/// The file another app asked CaretFlow to open ("Open with", "Share"), handed out once:
/// { uri } or { text } (shared plain text), or null
#[tauri::command]
pub async fn android_take_intent() -> Value {
    call::<Value>("takeIntent", json!({})).unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn android_share(path: String, mime: String) -> Result<(), String> {
    call::<Value>("share", json!({ "path": path, "mime": mime })).map(|_| ())
}

/// Open a file in another app (a PDF after export, a linked file)
#[tauri::command]
pub async fn android_open_path(path: String) -> Result<(), String> {
    call::<Value>("openPath", json!({ "path": path })).map(|_| ())
}

/// The system print dialog for an HTML file (File → Print…)
#[tauri::command]
pub async fn android_print(html: String, title: String) -> Result<(), String> {
    call::<Value>("printDialog", json!({ "html": html, "title": title })).map(|_| ())
}

/// The colour behind the status and navigation bars, so they match the theme
#[tauri::command]
pub async fn android_bar_color(color: String, dark: bool) {
    let _ = call::<Value>("barColor", json!({ "color": color, "dark": dark }));
}

/// Android 12+: the wallpaper's main color (Material You), or null on older Android
#[tauri::command]
pub async fn android_system_color() -> Option<String> {
    call::<Value>("systemColor", json!({})).ok()?["color"].as_str().map(String::from)
}

/// { storage, library, documents }: the shared storage root, CaretFlow's own folder
/// (always writable) and Documents
#[tauri::command]
pub async fn android_dirs() -> Result<Value, String> {
    call("dirs", json!({}))
}
