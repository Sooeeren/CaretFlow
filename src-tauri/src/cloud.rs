//! Cloud sync backend: the network and file-system work behind `src/cloud.js`.
//! The sync logic itself lives in the frontend; these commands only move bytes, so file contents
//! never travel through the IPC bridge (uploads read the file here, downloads write it here).
//! Nothing in this module runs unless the user turned on Cloud Sync and set up their own server.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, UNIX_EPOCH};
use tauri::Manager;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// ───────────────────────────── HTTP (WebDAV and S3)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpReq {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    /// request body, base64
    body: Option<String>,
    /// or: send this local file as the body
    body_file: Option<String>,
    /// write a successful (2xx) response body to this local file instead of returning it
    save_to: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct HttpRes {
    status: u16,
    headers: Vec<(String, String)>,
    /// response body, base64 (empty when it went to `save_to`)
    body: String,
}

pub(crate) fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    // reqwest is built without a default TLS crypto provider (the updater does the same)
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let b = reqwest::Client::builder()
        .user_agent(concat!("CaretFlow/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15));
    // Android: reqwest's default verifier (rustls-platform-verifier) panics there unless it was
    // set up from Java first, and the release build aborts on a panic: the app closed on its
    // first HTTPS request (the update check, 2.5 s after start). Mozilla's roots instead.
    #[cfg(target_os = "android")]
    let b = {
        let mut roots = rustls::RootCertStore::empty();
        roots.add_parsable_certificates(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().cloned());
        b.tls_backend_preconfigured(rustls::ClientConfig::builder().with_root_certificates(roots).with_no_client_auth())
    };
    let c = b.build().map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| c))
}

/// Atomic write: a temp file next to the target, then rename over it.
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".folio~");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        fs::write(path, data).map_err(|e2| format!("{e}; {e2}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cloud_http(req: HttpReq) -> Result<HttpRes, String> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut rb = client()?
        .request(method, &req.url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(60_000)));
    for (k, v) in &req.headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(f) = &req.body_file {
        rb = rb.body(fs::read(f).map_err(|e| format!("{f}: {e}"))?);
    } else if let Some(b) = &req.body {
        rb = rb.body(B64.decode(b).map_err(|e| e.to_string())?);
    }
    let res = rb.send().await.map_err(|e| {
        // reqwest's top-level message ("error sending request") hides the useful part
        let mut msg = e.to_string();
        let mut src = std::error::Error::source(&e);
        while let Some(s) = src {
            msg = format!("{msg}: {s}");
            src = s.source();
        }
        msg
    })?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()))
        .collect();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let mut body = String::new();
    match &req.save_to {
        Some(p) if (200..300).contains(&status) => write_atomic(Path::new(p), &bytes)?,
        _ => body = B64.encode(&bytes),
    }
    Ok(HttpRes { status, headers, body })
}

// ───────────────────────────── local folder

#[derive(Serialize)]
pub struct LocalFile {
    rel: String,
    size: u64,
    mtime: u64,
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__", "vendor"];
const NOTE_EXT: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
];

fn scan(dir: &Path, prefix: &str, all: bool, depth: u32, out: &mut Vec<LocalFile>) {
    if depth > 20 || out.len() >= 20_000 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with('$') || name.ends_with(".folio~") {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                scan(&e.path(), &rel, all, depth + 1, out);
            }
            continue;
        }
        let ext = Path::new(&name).extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if !all && !NOTE_EXT.contains(&ext.as_str()) {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(LocalFile { rel, size: meta.len(), mtime });
    }
}

/// Every file under `root` that sync looks at, with paths relative to it ('/' separated).
/// `all` = every file type, otherwise Markdown and images only. Hidden files and folders are skipped.
#[tauri::command]
pub async fn cloud_scan(root: String, all: bool) -> Result<Vec<LocalFile>, String> {
    let r = PathBuf::from(&root);
    if !r.is_dir() {
        return Err(format!("the sync folder does not exist: {root}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        scan(&r, "", all, 0, &mut out);
        out
    })
    .await
    .map_err(|e| e.to_string())
}

/// A local file in the sync folder; refuses anything that would escape it.
fn inside(root: &str, rel: &str) -> Result<PathBuf, String> {
    if rel.split('/').any(|s| s.is_empty() || s == "." || s == "..") || rel.contains('\\') || rel.contains(':') {
        return Err(format!("invalid file name: {rel}"));
    }
    Ok(Path::new(root).join(rel))
}

/// Move a file out of the sync folder into CaretFlow's sync trash (instead of deleting it),
/// keeping its folder structure under a folder named `stamp`. Returns where it went.
#[tauri::command]
pub fn cloud_trash(app: tauri::AppHandle, root: String, rel: String, stamp: String) -> Result<String, String> {
    let src = inside(&root, &rel)?;
    if stamp.is_empty() || stamp.contains(['/', '\\', '.', ':']) {
        return Err("invalid trash folder".into());
    }
    let dest = trash_dir(&app)?.join(&stamp).join(&rel);
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    if fs::rename(&src, &dest).is_err() {
        // across drives: copy, then remove
        fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        fs::remove_file(&src).map_err(|e| e.to_string())?;
    }
    // leave no empty folders behind in the sync folder
    let mut dir = src.parent();
    while let Some(d) = dir {
        if d == Path::new(&root) || fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
    Ok(dest.to_string_lossy().to_string())
}

fn trash_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("sync-trash"))
}

#[tauri::command]
pub fn cloud_trash_dir(app: tauri::AppHandle) -> Result<String, String> {
    let d = trash_dir(&app)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.to_string_lossy().to_string())
}

// ───────────────────────────── passwords and API keys (Cloud Sync, AI Writing Help, MCP token)

// Kept out of the web view's storage: a file in CaretFlow's config folder that only the user can
// read (mode 600 on Linux; the per-user AppData folder on Windows).
fn secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("secrets.json"))
}

fn read_secrets(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    let dir = app.path().app_config_dir().ok();
    // 0.7.0 kept Cloud Sync passwords in cloud-secrets.json; read it until secrets.json exists
    [secrets_path(app).ok(), dir.map(|d| d.join("cloud-secrets.json"))]
        .into_iter()
        .flatten()
        .find_map(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, key: String) -> Option<String> {
    read_secrets(&app).remove(&key)
}

/// An empty value removes the entry.
#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut all = read_secrets(&app);
    if value.is_empty() {
        all.remove(&key);
    } else {
        all.insert(key, value);
    }
    let p = secrets_path(&app)?;
    write_atomic(&p, serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ───────────────────────────── rclone (Google Drive, Proton Drive, OneDrive, Dropbox, …)

#[derive(Serialize)]
pub struct RcloneOut {
    code: i32,
    /// base64, so `rclone cat` can return any file
    stdout: String,
    stderr: String,
}

/// Run the user's rclone with these arguments. CaretFlow never configures rclone itself:
/// remotes are set up with `rclone config`, which keeps the logins.
#[tauri::command]
pub async fn cloud_rclone(exe: String, args: Vec<String>, timeout_ms: Option<u64>) -> Result<RcloneOut, String> {
    let exe = if exe.trim().is_empty() { "rclone".to_string() } else { exe };
    let limit = Duration::from_millis(timeout_ms.unwrap_or(120_000));
    let run = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(&args).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
        }
        cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("rclone was not found ({exe}). Install it from rclone.org or set its path in Preferences → Cloud Sync")
            } else {
                format!("{exe}: {e}")
            }
        })
    });
    let out = tokio::time::timeout(limit, run)
        .await
        .map_err(|_| "rclone did not answer in time".to_string())?
        .map_err(|e| e.to_string())??;
    Ok(RcloneOut {
        code: out.status.code().unwrap_or(-1),
        stdout: B64.encode(&out.stdout),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}
