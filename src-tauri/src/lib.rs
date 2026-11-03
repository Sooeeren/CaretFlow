use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tauri::Manager;

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

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let s = String::from_utf8_lossy(&bytes);
    Ok(s.trim_start_matches('\u{feff}').to_string())
}

/// Atomic write: write to a temp file next to the target, then rename over it.
#[tauri::command]
fn write_text(path: String, content: String) -> Result<u64, String> {
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

#[tauri::command]
fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("a file with that name already exists".into());
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn mtime(path: String) -> Result<u64, String> {
    mtime_of(Path::new(&path))
}

#[tauri::command]
fn exists(path: String) -> bool {
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

/// Append a diagnostic line to %TEMP%/folio.log (errors only; kept small).
#[tauri::command]
fn log_line(line: String) {
    use std::io::Write;
    let p = std::env::temp_dir().join("folio.log");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .setup(|app| {
            // Safety net: the frontend shows the window once the first paint is ready.
            // If anything goes wrong there, show it anyway.
            if let Some(win) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    let _ = win.show();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            write_bytes,
            copy_file,
            rename_path,
            mtime,
            exists,
            is_dir,
            list_dir,
            walk_md,
            search_files,
            initial_path,
            new_window,
            log_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
