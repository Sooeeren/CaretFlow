// Discord Rich Presence (the "Discord Status" extension, src/discord.js).
// Talks to the Discord app on this computer over its local IPC: a named pipe on Windows, a Unix
// socket on Linux. CaretFlow itself sends nothing over the network; Discord shows the activity.
// The protocol is small (8-byte header + JSON), so no extra crate is needed.

use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
type Pipe = std::fs::File;
#[cfg(unix)]
type Pipe = std::os::unix::net::UnixStream;

struct Conn {
    pipe: Pipe,
    client_id: String,
}

static CONN: Mutex<Option<Conn>> = Mutex::new(None);

const HANDSHAKE: u32 = 0;
const FRAME: u32 = 1;
const CLOSE: u32 = 2;

/// Where Discord listens: discord-ipc-0 … 9, plus the Flatpak and Snap sandboxes on Linux.
fn candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        (0..10).map(|i| PathBuf::from(format!(r"\\?\pipe\discord-ipc-{i}"))).collect()
    }
    #[cfg(unix)]
    {
        let mut bases: Vec<PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            .iter()
            .filter_map(|k| std::env::var_os(k).map(PathBuf::from))
            .collect();
        bases.push(PathBuf::from("/tmp"));
        let subs = ["", "app/com.discordapp.Discord", "app/dev.vencord.Vesktop", "snap.discord", ".flatpak/dev.vencord.Vesktop/xdg-run"];
        let mut out = vec![];
        for b in &bases {
            for s in subs {
                for i in 0..10 {
                    out.push(b.join(s).join(format!("discord-ipc-{i}")));
                }
            }
        }
        out
    }
}

fn open(path: &PathBuf) -> io::Result<Pipe> {
    #[cfg(windows)]
    {
        std::fs::OpenOptions::new().read(true).write(true).open(path)
    }
    #[cfg(unix)]
    {
        let s = std::os::unix::net::UnixStream::connect(path)?;
        // a Discord that hangs must not hang the command forever
        s.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        s.set_write_timeout(Some(std::time::Duration::from_secs(5)))?;
        Ok(s)
    }
}

fn send(p: &mut Pipe, op: u32, data: &Value) -> io::Result<()> {
    let body = data.to_string().into_bytes();
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    p.write_all(&buf)?;
    p.flush()
}

fn recv(p: &mut Pipe) -> io::Result<(u32, Value)> {
    let mut head = [0u8; 8];
    p.read_exact(&mut head)?;
    let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
    if len > 1 << 20 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Discord sent an oversized frame"));
    }
    let mut body = vec![0u8; len];
    p.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

fn connect(client_id: &str) -> Result<Conn, String> {
    for path in candidates() {
        let Ok(mut pipe) = open(&path) else { continue };
        if send(&mut pipe, HANDSHAKE, &json!({ "v": 1, "client_id": client_id })).is_err() {
            continue;
        }
        match recv(&mut pipe) {
            Ok((CLOSE, v)) => return Err(format!("Discord refused the connection: {}", v["message"].as_str().unwrap_or("unknown reason"))),
            Ok(_) => return Ok(Conn { pipe, client_id: client_id.to_string() }),
            Err(_) => continue,
        }
    }
    Err("Discord is not running".into())
}

fn nonce() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0).to_string()
}

fn set_activity(client_id: &str, activity: &Value) -> Result<(), String> {
    let mut guard = CONN.lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().is_some_and(|c| c.client_id != client_id) {
        *guard = None;
    }
    let msg = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce(),
    });
    // a pipe left over from a Discord that was restarted fails on write: reconnect once
    for attempt in 0..2 {
        if guard.is_none() {
            *guard = Some(connect(client_id)?);
        }
        let c = guard.as_mut().unwrap();
        match send(&mut c.pipe, FRAME, &msg).and_then(|_| recv(&mut c.pipe)) {
            Ok((CLOSE, v)) => {
                *guard = None;
                return Err(v["message"].as_str().unwrap_or("Discord closed the connection").to_string());
            }
            Ok((_, v)) if v["evt"] == "ERROR" => {
                return Err(v["data"]["message"].as_str().unwrap_or("Discord rejected the status").to_string());
            }
            Ok(_) => return Ok(()),
            Err(e) => {
                *guard = None;
                if attempt == 1 {
                    return Err(format!("Lost the connection to Discord: {e}"));
                }
            }
        }
    }
    Ok(())
}

/// Show `activity` (Discord's activity object) on the user's profile.
#[tauri::command]
pub async fn discord_set(client_id: String, activity: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_activity(&client_id, &activity)).await.map_err(|e| e.to_string())?
}

/// Remove the status: closing the pipe makes Discord drop it at once.
#[tauri::command]
pub async fn discord_clear() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        CONN.lock().unwrap_or_else(|e| e.into_inner()).take();
    })
    .await
    .map_err(|e| e.to_string())
}
