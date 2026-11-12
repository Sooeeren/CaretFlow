// CaretFlow's data folder for downloaded language data, and the "Advanced Grammar" extension
// (src/ltlocal.js): LanguageTool running on this computer.
//
// LanguageTool is a Java program. Once the user installs the extension and asks for it, this
// module downloads LanguageTool and a Java runtime (Eclipse Temurin) into the data folder, plus
// n-gram data per language if wanted, starts the server on a free port on 127.0.0.1 when the
// spelling checker needs it, and stops it when asked, when idle, or when CaretFlow exits.
// Nothing here runs or downloads unless the user turned it on.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// `<app data>/<sub>`, created if needed (dictionaries, languagetool).
#[tauri::command]
pub fn data_dir(app: tauri::AppHandle, sub: String) -> Result<String, String> {
    if sub.is_empty() || !sub.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad folder name".into());
    }
    let dir = data_root(&app)?.join(sub);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Delete a file or folder, but only inside the data folder.
#[tauri::command]
pub fn data_remove(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let root = data_root(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = match Path::new(&path).canonicalize() {
        Ok(p) => p,
        Err(_) => return Ok(()), // already gone
    };
    if !p.starts_with(&root) || p == root {
        return Err("not in CaretFlow's data folder".into());
    }
    if p.is_dir() {
        fs::remove_dir_all(&p)
    } else {
        fs::remove_file(&p)
    }
    .map_err(|e| e.to_string())
}

#[cfg(desktop)]
pub use local::*;

#[cfg(desktop)]
mod local {
    use super::data_root;
    use serde::Serialize;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::Emitter;

    const LT_URL: &str = "https://languagetool.org/download/LanguageTool-stable.zip";
    /// n-gram files per language (they don't change: the data is from 2015/2018)
    const NGRAMS: &[(&str, &str)] = &[
        ("en", "ngrams-en-20150817.zip"),
        ("de", "ngrams-de-20150819.zip"),
        ("fr", "ngrams-fr-20150913.zip"),
        ("es", "ngrams-es-20150915.zip"),
        ("nl", "ngrams-nl-20181229.zip"),
    ];

    enum Server {
        Ours(Child, u16),
        /// left running by an earlier CaretFlow that didn't exit cleanly; found through server.json
        Adopted(u32, u16),
    }
    static SERVER: Mutex<Option<Server>> = Mutex::new(None);
    static CANCEL: AtomicBool = AtomicBool::new(false);
    static BUSY: Mutex<Option<String>> = Mutex::new(None);

    fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let d = data_root(app)?.join("languagetool");
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        Ok(d)
    }

    /// `dir/rel…`, or one folder further down (archives unpack into a versioned folder).
    fn find(dir: &Path, rel: &[&str]) -> Option<PathBuf> {
        let direct = rel.iter().fold(dir.to_path_buf(), |p, r| p.join(r));
        if direct.is_file() {
            return Some(direct);
        }
        for e in fs::read_dir(dir).ok()?.flatten() {
            if e.path().is_dir() {
                let p = rel.iter().fold(e.path(), |p, r| p.join(r));
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    }
    fn java(b: &Path) -> Option<PathBuf> {
        find(&b.join("jre"), &["bin", if cfg!(windows) { "java.exe" } else { "java" }])
    }
    fn server_jar(b: &Path) -> Option<PathBuf> {
        find(&b.join("lt"), &["languagetool-server.jar"])
    }
    fn ngram_langs(b: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(b.join("ngrams"))
            .map(|r| {
                r.flatten()
                    .filter(|e| e.path().join("1grams").is_dir())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        v.sort();
        v
    }
    fn dir_size(p: &Path) -> u64 {
        let Ok(rd) = fs::read_dir(p) else { return 0 };
        rd.flatten()
            .map(|e| match e.file_type() {
                Ok(t) if t.is_dir() => dir_size(&e.path()),
                _ => e.metadata().map(|m| m.len()).unwrap_or(0),
            })
            .sum()
    }
    fn find_dir(dir: &Path, name: &str) -> Option<PathBuf> {
        if dir.join(name).join("1grams").is_dir() {
            return Some(dir.join(name));
        }
        fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.join(name).join("1grams").is_dir())
            .map(|p| p.join(name))
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LtStatus {
        installed: bool,
        running: Option<u16>,
        ngrams: Vec<String>,
        /// what is downloading or unpacking right now
        busy: Option<String>,
        bytes: u64,
        dir: String,
    }

    #[tauri::command]
    pub fn lt_status(app: tauri::AppHandle) -> Result<LtStatus, String> {
        let b = base(&app)?;
        Ok(LtStatus {
            installed: java(&b).is_some() && server_jar(&b).is_some(),
            running: running_port(),
            ngrams: ngram_langs(&b),
            busy: BUSY.lock().unwrap().clone(),
            bytes: dir_size(&b),
            dir: b.to_string_lossy().into_owned(),
        })
    }

    #[derive(Serialize, Clone)]
    struct Progress {
        what: String,
        done: u64,
        total: u64,
    }
    fn progress(app: &tauri::AppHandle, what: &str, done: u64, total: u64) {
        let _ = app.emit("lt-progress", Progress { what: what.into(), done, total });
    }

    /// Stream a download to `dest` with progress events; a `.part` file until it is complete.
    async fn download(app: &tauri::AppHandle, url: &str, dest: &Path, what: &str) -> Result<(), String> {
        let mut res = crate::cloud::client()?.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("{url}: HTTP {}", res.status()));
        }
        let total = res.content_length().unwrap_or(0);
        let part = dest.with_extension("part");
        let mut f = fs::File::create(&part).map_err(|e| e.to_string())?;
        let (mut done, mut shown) = (0u64, 0u64);
        progress(app, what, 0, total);
        loop {
            if CANCEL.load(Ordering::Relaxed) {
                drop(f);
                let _ = fs::remove_file(&part);
                return Err("cancelled".into());
            }
            let chunk = match res.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => {
                    drop(f);
                    let _ = fs::remove_file(&part);
                    return Err(format!("{what}: {e}"));
                }
            };
            f.write_all(&chunk).map_err(|e| e.to_string())?;
            done += chunk.len() as u64;
            if done - shown > 1 << 20 {
                shown = done;
                progress(app, what, done, total);
            }
        }
        drop(f);
        fs::rename(&part, dest).map_err(|e| e.to_string())
    }

    /// Unpack a .zip or .tar.gz into `into` (replacing what was there), then delete the archive.
    async fn unpack(app: &tauri::AppHandle, archive: PathBuf, into: PathBuf, what: &str) -> Result<(), String> {
        progress(app, &format!("Unpacking {what}"), 0, 0);
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let _ = fs::remove_dir_all(&into);
            fs::create_dir_all(&into).map_err(|e| e.to_string())?;
            let file = fs::File::open(&archive).map_err(|e| e.to_string())?;
            let r = if archive.to_string_lossy().ends_with(".tar.gz") {
                tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(&into).map_err(|e| e.to_string())
            } else {
                zip::ZipArchive::new(file).and_then(|mut z| z.extract(&into)).map_err(|e| e.to_string())
            };
            let _ = fs::remove_file(&archive);
            r
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// One download job at a time; lt_status tells the frontend what it is.
    async fn job<F: std::future::Future<Output = Result<(), String>>>(what: &str, f: F) -> Result<(), String> {
        {
            let mut busy = BUSY.lock().unwrap();
            if let Some(b) = &*busy {
                return Err(format!("Already downloading {b}"));
            }
            *busy = Some(what.into());
        }
        CANCEL.store(false, Ordering::Relaxed);
        let r = f.await;
        *BUSY.lock().unwrap() = None;
        r
    }

    /// Download LanguageTool (~250 MB) and a Java runtime (~50 MB).
    #[tauri::command]
    pub async fn lt_install(app: tauri::AppHandle) -> Result<(), String> {
        let b = base(&app)?;
        job("LanguageTool", async {
            if java(&b).is_none() {
                let os = if cfg!(windows) { "windows" } else { "linux" };
                let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
                let url = format!("https://api.adoptium.net/v3/binary/latest/21/ga/{os}/{arch}/jre/hotspot/normal/eclipse");
                let file = b.join(if cfg!(windows) { "jre.zip" } else { "jre.tar.gz" });
                download(&app, &url, &file, "Java runtime").await?;
                unpack(&app, file, b.join("jre"), "Java runtime").await?;
            }
            if server_jar(&b).is_none() {
                let file = b.join("lt.zip");
                download(&app, LT_URL, &file, "LanguageTool").await?;
                unpack(&app, file, b.join("lt"), "LanguageTool").await?;
            }
            if java(&b).is_none() || server_jar(&b).is_none() {
                return Err("the download did not contain what was expected".into());
            }
            Ok(())
        })
        .await
    }

    /// Download the n-gram data for one language (1–9 GB): catches confused words like their/there.
    #[tauri::command]
    pub async fn lt_ngrams(app: tauri::AppHandle, lang: String) -> Result<(), String> {
        let (_, file) = NGRAMS.iter().find(|(l, _)| *l == lang).ok_or("no n-gram data for this language")?;
        let b = base(&app)?;
        let what = format!("n-grams ({lang})");
        job(&what, async {
            let zip = b.join(file);
            download(&app, &format!("https://languagetool.org/download/ngram-data/{file}"), &zip, &what).await?;
            // the archive holds a folder named after the language
            let tmp = b.join(format!("ngrams-{lang}.tmp"));
            unpack(&app, zip, tmp.clone(), &what).await?;
            let src = find_dir(&tmp, &lang).ok_or("unexpected n-gram archive")?;
            let dest = b.join("ngrams").join(&lang);
            let _ = fs::remove_dir_all(&dest);
            fs::create_dir_all(b.join("ngrams")).map_err(|e| e.to_string())?;
            fs::rename(&src, &dest).map_err(|e| e.to_string())?;
            let _ = fs::remove_dir_all(&tmp);
            Ok(())
        })
        .await
    }

    #[tauri::command]
    pub fn lt_cancel() {
        CANCEL.store(true, Ordering::Relaxed);
    }

    /// Remove everything ("all") or one language's n-grams ("ngrams:de").
    #[tauri::command]
    pub fn lt_remove(app: tauri::AppHandle, what: String) -> Result<(), String> {
        let b = base(&app)?;
        if what == "all" {
            stop();
            fs::remove_dir_all(&b).map_err(|e| e.to_string())
        } else if let Some(lang) = what.strip_prefix("ngrams:") {
            if lang.is_empty() || !lang.chars().all(|c| c.is_ascii_alphabetic()) {
                return Err("bad language".into());
            }
            fs::remove_dir_all(b.join("ngrams").join(lang)).map_err(|e| e.to_string())
        } else {
            Err("unknown".into())
        }
    }

    async fn answers(port: u16) -> bool {
        let Ok(c) = crate::cloud::client() else { return false };
        c.get(format!("http://127.0.0.1:{port}/v2/languages"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    fn kill_pid(pid: u32) {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .status();
        }
        #[cfg(unix)]
        {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
    }

    /// Start the server (or return the port of the running one). Takes a few seconds.
    #[tauri::command]
    pub async fn lt_start(app: tauri::AppHandle, memory_mb: u32, ngrams: bool) -> Result<u16, String> {
        if let Some(p) = running_port() {
            return Ok(p);
        }
        let b = base(&app)?;
        let state = b.join("server.json");
        // a server an earlier CaretFlow left running: use it instead of starting a second one
        let old = fs::read_to_string(&state).ok().and_then(|s| {
            let v: serde_json::Value = serde_json::from_str(&s).ok()?;
            Some((v["pid"].as_u64()? as u32, v["port"].as_u64()? as u16))
        });
        if let Some((pid, port)) = old {
            if answers(port).await {
                *SERVER.lock().unwrap() = Some(Server::Adopted(pid, port));
                return Ok(port);
            }
            let _ = fs::remove_file(&state);
        }
        let (java, jar) = match (java(&b), server_jar(&b)) {
            (Some(j), Some(s)) => (j, s),
            _ => return Err("LanguageTool is not downloaded yet".into()),
        };
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map_err(|e| e.to_string())?
            .port();
        let log = fs::File::create(b.join("server.log")).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(java);
        cmd.arg(format!("-Xmx{}m", memory_mb.clamp(256, 8192)))
            .arg("-cp")
            .arg(&jar)
            .arg("org.languagetool.server.HTTPServer")
            .args(["--port", &port.to_string(), "--allow-origin", "*"])
            .current_dir(jar.parent().unwrap_or(&b))
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        if ngrams && !ngram_langs(&b).is_empty() {
            cmd.arg("--languageModel").arg(b.join("ngrams"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window
        }
        let child = cmd.spawn().map_err(|e| format!("could not start Java: {e}"))?;
        let _ = fs::write(&state, serde_json::json!({ "pid": child.id(), "port": port }).to_string());
        *SERVER.lock().unwrap() = Some(Server::Ours(child, port));
        // ready when it answers; Java needs a few seconds (more on the first start)
        for _ in 0..180 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if answers(port).await {
                return Ok(port);
            }
            let exited = match &mut *SERVER.lock().unwrap() {
                Some(Server::Ours(c, p)) if *p == port => c.try_wait().ok().flatten().is_some(),
                _ => true, // stopped meanwhile
            };
            if exited {
                stop();
                let log = fs::read_to_string(b.join("server.log")).unwrap_or_default();
                let tail: Vec<&str> = log.lines().rev().take(3).collect();
                let tail: Vec<&str> = tail.into_iter().rev().collect();
                return Err(format!("LanguageTool stopped while starting. {}", tail.join(" / ")));
            }
        }
        stop();
        Err("LanguageTool did not start within 90 seconds".into())
    }

    fn running_port() -> Option<u16> {
        let mut s = SERVER.lock().unwrap();
        match &mut *s {
            Some(Server::Ours(c, p)) => {
                if c.try_wait().ok().flatten().is_some() {
                    *s = None;
                    None
                } else {
                    Some(*p)
                }
            }
            Some(Server::Adopted(_, p)) => Some(*p),
            None => None,
        }
    }

    #[tauri::command]
    pub fn lt_stop(app: tauri::AppHandle) {
        stop();
        if let Ok(b) = base(&app) {
            let _ = fs::remove_file(b.join("server.json"));
        }
    }

    /// Stop the server; also called when CaretFlow exits.
    pub fn stop() {
        match SERVER.lock().unwrap().take() {
            Some(Server::Ours(mut c, _)) => {
                let _ = c.kill();
                let _ = c.wait();
            }
            Some(Server::Adopted(pid, _)) => kill_pid(pid),
            None => {}
        }
    }
}
