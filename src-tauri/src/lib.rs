use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[cfg(target_os = "android")]
mod android;
mod cloud;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod discord;
mod langtool;
mod mcp;
mod pdf;

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    dir: bool,
}

const MD_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"];
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__", "vendor"];

fn is_md(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| MD_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('$')
}

fn mtime_of(path: &Path) -> Result<u64, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    let t = m.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

// The file commands are async: on Android a content:// file is read through the Kotlin
// plugin, which must not be waited for on the main thread.
#[tauri::command]
async fn read_text(path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    let bytes = if android::is_uri(&path) { android::read_uri(&path)? } else { fs::read(&path).map_err(|e| e.to_string())? };
    #[cfg(not(target_os = "android"))]
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let s = String::from_utf8_lossy(&bytes);
    Ok(s.trim_start_matches('\u{feff}').to_string())
}

/// Atomic write: write to a temp file next to the target, then rename over it.
#[tauri::command]
async fn write_text(path: String, content: String) -> Result<u64, String> {
    #[cfg(target_os = "android")]
    if android::is_uri(&path) {
        android::write_uri(&path, content.as_bytes())?;
        return Ok(android::uri_info(&path)["mtime"].as_u64().unwrap_or(0));
    }
    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp = p.clone().into_os_string();
    tmp.push(".folio~");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, &p) {
        // Fall back to a direct write (e.g. cross-device or locked file)
        let _ = fs::remove_file(&tmp);
        fs::write(&p, content.as_bytes()).map_err(|e2| format!("{e}; {e2}"))?;
    }
    mtime_of(&p)
}

#[tauri::command]
fn write_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    let p = PathBuf::from(&to);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::copy(&from, &p).map(|_| ()).map_err(|e| e.to_string())
}

/// A new folder (Android's file browser → New folder)
#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("a file with that name already exists".into());
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
async fn mtime(path: String) -> Result<u64, String> {
    #[cfg(target_os = "android")]
    if android::is_uri(&path) {
        return android::uri_info(&path)["mtime"].as_u64().ok_or_else(|| "no modification time".into());
    }
    mtime_of(Path::new(&path))
}

#[tauri::command]
async fn exists(path: String) -> bool {
    #[cfg(target_os = "android")]
    if android::is_uri(&path) {
        return android::uri_info(&path)["exists"].as_bool().unwrap_or(false);
    }
    Path::new(&path).exists()
}

#[tauri::command]
fn is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if hidden(&name) {
                return None;
            }
            let p = e.path();
            let dir = p.is_dir();
            if dir && SKIP_DIRS.contains(&name.as_str()) {
                return None;
            }
            if !dir && !is_md(&p) {
                return None;
            }
            Some(Entry { name, path: p.to_string_lossy().to_string(), dir })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<String>) {
    if depth > 10 || out.len() >= 5000 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        if hidden(&name) {
            continue;
        }
        let p = e.path();
        if p.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk(&p, depth + 1, out);
            }
        } else if is_md(&p) {
            out.push(p.to_string_lossy().to_string());
            if out.len() >= 5000 {
                return;
            }
        }
    }
}

#[tauri::command]
async fn walk_md(root: String) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(&root), 0, &mut out);
    out
}

/// Search every markdown file under `root` for `query` (case-insensitive).
#[derive(Serialize)]
struct Hit {
    path: String,
    line: usize,
    text: String,
}

#[tauri::command]
async fn search_files(root: String, query: String) -> Vec<Hit> {
    let mut files = Vec::new();
    walk(Path::new(&root), 0, &mut files);
    let q = query.to_lowercase();
    let mut hits = Vec::new();
    if q.is_empty() {
        return hits;
    }
    for f in files {
        let Ok(s) = fs::read_to_string(&f) else { continue };
        for (i, line) in s.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                let text: String = line.trim().chars().take(160).collect();
                hits.push(Hit { path: f.clone(), line: i + 1, text });
                if hits.len() >= 500 {
                    return hits;
                }
            }
        }
    }
    hits
}

/// Append a diagnostic line to %TEMP%/caretflow.log (errors only; kept small).
#[tauri::command]
fn log_line(line: String) {
    use std::io::Write;
    let p = std::env::temp_dir().join("caretflow.log");
    if fs::metadata(&p).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = fs::remove_file(&p);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{line}");
    }
}

#[tauri::command]
fn initial_path() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-')).map(|a| {
        std::path::absolute(&a)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(a)
    })
}

#[tauri::command]
fn new_window(path: Option<String>) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    if let Some(p) = path {
        cmd.arg(p);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

#[cfg(desktop)]
fn is_cli_export() -> bool {
    std::env::args().any(|a| a == "--export-pdf" || a == "--export-html")
}

// ── UI config read by Rust before the window exists (the title-bar choice must be
//    made at creation time: GTK cannot add decorations back to a mapped window)
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UiConfig {
    native_titlebar: Option<bool>,
}

fn ui_config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ui.json"))
}

fn read_ui_config(app: &tauri::AppHandle) -> UiConfig {
    ui_config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn set_native_titlebar(app: tauri::AppHandle, native: bool) -> Result<(), String> {
    let p = ui_config_path(&app).ok_or("no config dir")?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let cfg = UiConfig { native_titlebar: Some(native) };
    fs::write(p, serde_json::to_string(&cfg).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn native_titlebar(app: tauri::AppHandle) -> bool {
    read_ui_config(&app).native_titlebar.unwrap_or(false)
}

/// Start a fresh instance (optionally opening `path`) and quit this one.
#[tauri::command]
fn restart(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    new_window(path)?;
    app.exit(0);
    Ok(())
}

/// Delete a temporary export file. Only CaretFlow's own temp files can be removed.
#[tauri::command]
fn remove_temp(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let preview = name.starts_with("folio-preview-")
        && name.ends_with(".pdf")
        && p.parent().map(|d| d == std::env::temp_dir().as_path()).unwrap_or(false);
    if !(path.ends_with(".folio-tmp.html") || preview) {
        return Err("refusing to delete a non-temporary file".into());
    }
    fs::remove_file(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Raw file bytes (sent as binary, not JSON) — used by the PDF page preview.
#[tauri::command]
fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}

/// `html` is the file behind `url`. Android prints it in a WebView of its own: mobile apps
/// have a single window, so the hidden export window used on the desktop can't be made there.
#[tauri::command]
async fn export_pdf(app: tauri::AppHandle, url: String, out: String, options: pdf::PdfOptions, html: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, url);
        pdf::export_android(html.ok_or("no HTML file to print")?, out, options).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = html;
        pdf::export(app, url, out, options).await
    }
}

/// How this copy of CaretFlow was installed, so the updater knows whether it can replace it:
/// "nsis" (Windows installer), "appimage", "deb", "rpm", "rpm-dnf" (an rpm system that only installs
/// GPG-signed packages), "pacman" (Arch package, updated by the package manager), or "portable"
/// (a loose exe/binary, which the updater can't update in place).
/// For "rpm-dnf", "pacman" and "portable" the user is pointed to the download page instead.
#[tauri::command]
fn install_kind() -> &'static str {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    let exe = std::env::current_exe().ok();
    if cfg!(windows) {
        // the NSIS installer puts uninstall.exe next to caretflow.exe; CaretFlow-portable.exe has none
        let installed = exe
            .as_ref()
            .and_then(|e| e.parent())
            .map(|d| d.join("uninstall.exe").exists())
            .unwrap_or(false);
        return if installed { "nsis" } else { "portable" };
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return "appimage";
    }
    // deb/rpm install to /usr/bin; the raw `caretflow` binary can live anywhere
    let packaged = exe.map(|e| e.starts_with("/usr")).unwrap_or(false);
    // the Arch package reuses the .deb's binary, so check pacman's database before trusting that
    let pacman = packaged
        && fs::read_dir("/var/lib/pacman/local")
            .map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("caretflow-bin-")))
            .unwrap_or(false);
    if pacman {
        return "pacman";
    }
    match bundle_type() {
        Some(BundleType::Deb) if packaged => "deb",
        Some(BundleType::Rpm) if packaged => {
            // The updater installs with `rpm -U`. RPM 6 (Fedora 43 and later) refuses packages
            // without a GPG signature that way, and CaretFlow's aren't GPG-signed; dnf installs them.
            let level = std::process::Command::new("rpm")
                .args(["--eval", "%{_pkgverify_level}"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            if matches!(level.as_str(), "all" | "signature") {
                "rpm-dnf"
            } else {
                "rpm"
            }
        }
        _ => "portable",
    }
}

/// The running program's path (for the MCP setup snippets: Claude Desktop starts `caretflow --mcp`).
#[tauri::command]
fn exe_path() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| "caretflow".into())
}

#[cfg(desktop)]
fn desktop_window(app: &mut tauri::App) -> tauri::Result<()> {
    let native = read_ui_config(app.handle()).native_titlebar.unwrap_or(false);
    let win = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("CaretFlow")
        .inner_size(1120.0, 780.0)
        .min_inner_size(420.0, 320.0)
        .center()
        .visible(false)
        .decorations(native)
        .build()?;
    // Safety net: the frontend shows the window once the first paint is ready.
    // If anything goes wrong there, show it anyway (not in headless CLI export mode).
    if !is_cli_export() {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = win.show();
        });
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `caretflow --mcp`: a stdin/stdout MCP bridge to the running app, no window
    if std::env::args().any(|a| a == "--mcp") {
        mcp::bridge();
        return;
    }
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .with_filter(|label| label == "main")
                .build(),
        );
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android::init());
    builder
        .setup(|app| {
            // phones and tablets: one full-screen window, no title bar or size to choose
            #[cfg(mobile)]
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into())).build()?;
            #[cfg(desktop)]
            desktop_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            write_bytes,
            copy_file,
            rename_path,
            make_dir,
            mtime,
            exists,
            is_dir,
            list_dir,
            walk_md,
            search_files,
            initial_path,
            new_window,
            log_line,
            cli_args,
            set_native_titlebar,
            native_titlebar,
            restart,
            exit_app,
            export_pdf,
            remove_temp,
            temp_dir,
            read_bytes,
            install_kind,
            cloud::cloud_http,
            cloud::cloud_scan,
            cloud::cloud_trash,
            cloud::cloud_trash_dir,
            cloud::secret_get,
            cloud::secret_set,
            cloud::cloud_rclone,
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_reply,
            mcp::mcp_status,
            langtool::data_dir,
            langtool::data_remove,
            #[cfg(desktop)]
            langtool::lt_status,
            #[cfg(desktop)]
            langtool::lt_install,
            #[cfg(desktop)]
            langtool::lt_ngrams,
            #[cfg(desktop)]
            langtool::lt_cancel,
            #[cfg(desktop)]
            langtool::lt_remove,
            #[cfg(desktop)]
            langtool::lt_start,
            #[cfg(desktop)]
            langtool::lt_stop,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            discord::discord_set,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            discord::discord_clear,
            exe_path,
            #[cfg(target_os = "android")]
            android::android_storage,
            #[cfg(target_os = "android")]
            android::android_request_storage,
            #[cfg(target_os = "android")]
            android::android_resolve,
            #[cfg(target_os = "android")]
            android::android_copy_uri,
            #[cfg(target_os = "android")]
            android::android_take_intent,
            #[cfg(target_os = "android")]
            android::android_share,
            #[cfg(target_os = "android")]
            android::android_open_path,
            #[cfg(target_os = "android")]
            android::android_print,
            #[cfg(target_os = "android")]
            android::android_bar_color,
            #[cfg(target_os = "android")]
            android::android_dirs,
            #[cfg(target_os = "android")]
            android::android_system_color
        ])
        .build(tauri::generate_context!())
        .expect("error while running CaretFlow")
        .run(|_app, event| {
            // LanguageTool on this computer (Advanced Grammar) must not outlive CaretFlow
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = event {
                langtool::stop();
            }
            #[cfg(not(desktop))]
            let _ = event;
        });
}
