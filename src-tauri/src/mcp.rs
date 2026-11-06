//! MCP server (AI Writing Help): lets the user's AI app read the open document and send suggestions.
//! Streamable HTTP on 127.0.0.1 only, protected by a token. Tool calls are answered by the frontend
//! (src/mcp.js) through an event round trip; nothing here reads or writes documents.
//! `caretflow --mcp` is a stdin/stdout bridge for apps that only start programs (Claude Desktop).

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

/// MCP protocol versions this server speaks; the first is the default.
pub const PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26"];

#[derive(Default, Clone, Serialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
    pub last_seen_ms: u64,
}

const INSTRUCTIONS: &str = "CaretFlow is a Markdown editor. Use get_document to read the open document, then send corrections and suggestions with add_suggestions. CaretFlow shows them to the writer, who applies or ignores each one. You cannot change the document directly.";

fn tools() -> Value {
    let none = json!({ "type": "object", "properties": {} });
    json!([
        { "name": "get_document", "description": "The document open in CaretFlow: its Markdown, file name and the current selection.", "inputSchema": none },
        { "name": "get_selection", "description": "The text the writer selected in CaretFlow and the paragraph around it.", "inputSchema": none },
        { "name": "get_writing_issues", "description": "What CaretFlow's own spelling and grammar check found, so you don't repeat it.", "inputSchema": none },
        {
            "name": "add_suggestions",
            "description": "Send corrections or suggestions for the open document. CaretFlow underlines each `quote` and offers `replacement`; the writer applies or ignores it. Quote the exact text from the document, as short as possible.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "suggestions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "quote": { "type": "string", "description": "Exact text from the document" },
                                "replacement": { "type": "string", "description": "What to put instead (empty to delete)" },
                                "message": { "type": "string", "description": "One short sentence: why" },
                                "kind": { "type": "string", "description": "spelling, grammar, punctuation, clarity, conciseness, word choice, tone, structure or consistency" }
                            },
                            "required": ["quote", "replacement"]
                        }
                    }
                },
                "required": ["suggestions"]
            }
        },
        { "name": "clear_suggestions", "description": "Remove the suggestions you sent to CaretFlow.", "inputSchema": none }
    ])
}

fn ok(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}
fn err(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Handle one JSON-RPC message. Returns the response, or None for notifications.
/// `call(tool, arguments)` asks the frontend to run a tool.
pub fn handle(req: &Value, client: &mut ClientInfo, call: &dyn Fn(&str, Value) -> Result<Value, String>) -> Option<Value> {
    let id = req.get("id")?.clone(); // no id = a notification: nothing to answer
    let method = req["method"].as_str().unwrap_or("");
    let params = &req["params"];
    client.last_seen_ms = now_ms();
    Some(match method {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or("");
            let version = if PROTOCOLS.contains(&asked) { asked } else { PROTOCOLS[0] };
            if let Some(name) = params["clientInfo"]["name"].as_str() {
                client.name = name.to_string();
                client.version = params["clientInfo"]["version"].as_str().unwrap_or("").to_string();
            }
            ok(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {}, "prompts": {} },
                    "serverInfo": { "name": "CaretFlow", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS
                }),
            )
        }
        "ping" => ok(&id, json!({})),
        "tools/list" => ok(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let known = tools().as_array().map(|t| t.iter().any(|x| x["name"] == name)).unwrap_or(false);
            let res = if known { call(name, params.get("arguments").cloned().unwrap_or(json!({}))) } else { Err(format!("Unknown tool: {name}")) };
            match res {
                Ok(v) => ok(&id, json!({ "content": [{ "type": "text", "text": v.to_string() }] })),
                Err(e) => ok(&id, json!({ "content": [{ "type": "text", "text": e }], "isError": true })),
            }
        }
        "prompts/list" => ok(
            &id,
            json!({ "prompts": [{ "name": "review_document", "description": "Review the document open in CaretFlow and send suggestions" }] }),
        ),
        "prompts/get" if params["name"] == "review_document" => ok(
            &id,
            json!({
                "description": "Review the document open in CaretFlow",
                "messages": [{
                    "role": "user",
                    "content": { "type": "text", "text": "Review the document that is open in CaretFlow. Read it with get_document (and get_writing_issues, to skip what CaretFlow already marks). Look for spelling, grammar and punctuation mistakes, and for wording that could be clearer or shorter. Send each finding with add_suggestions, quoting the exact words from the document, as few as possible. Then tell me in two or three sentences what you found." }
                }]
            }),
        ),
        "prompts/get" => err(&id, -32602, "Unknown prompt"),
        _ => err(&id, -32601, "Method not found"),
    })
}

/// Checks before a request reaches `handle`: Err(HTTP status) when it must be refused.
pub fn check_request(method: &str, path: &str, origin: Option<&str>, auth: Option<&str>, token: &str) -> Result<(), u16> {
    if path.split('?').next() != Some("/mcp") {
        return Err(404);
    }
    // a web page in a browser must never reach this server (DNS rebinding)
    if let Some(o) = origin {
        let host = o.split("://").nth(1).unwrap_or("").split([':', '/']).next().unwrap_or("");
        if !matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
            return Err(403);
        }
    }
    if token.is_empty() || auth != Some(format!("Bearer {token}").as_str()) {
        return Err(401);
    }
    if method != "POST" {
        return Err(405);
    }
    Ok(())
}

// ───────────────────────────── a minimal HTTP/1.1 server (one request per connection)

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok()?;
    let mut r = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).ok()? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
        if headers.len() > 100 {
            return None;
        }
    }
    let mut body = Vec::new();
    if headers.get("transfer-encoding").map(|v| v.eq_ignore_ascii_case("chunked")).unwrap_or(false) {
        loop {
            let mut size = String::new();
            r.read_line(&mut size).ok()?;
            let n = usize::from_str_radix(size.trim().split(';').next()?, 16).ok()?;
            if n == 0 || body.len() + n > 10 << 20 {
                break;
            }
            let mut chunk = vec![0; n + 2];
            r.read_exact(&mut chunk).ok()?;
            body.extend_from_slice(&chunk[..n]);
        }
    } else if let Some(n) = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()) {
        if n > 10 << 20 {
            return None;
        }
        body.resize(n, 0);
        r.read_exact(&mut body).ok()?;
    }
    Some(HttpRequest { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, status: u16, extra: &[(&str, &str)], body: &str) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if status == 405 {
        head.push_str("Allow: POST\r\n");
    }
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

// ───────────────────────────── the running server

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static R: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(None))
}
fn sessions() -> &'static Mutex<HashMap<String, ClientInfo>> {
    static S: OnceLock<Mutex<HashMap<String, ClientInfo>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
fn pending() -> &'static Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>> {
    static P: OnceLock<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Where the bridge finds the port and token: <config dir>/mcp.json, the same folder Tauri uses.
fn bridge_file() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join("app.folio.markdown").join("mcp.json"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    running: bool,
    port: u16,
    clients: Vec<ClientInfo>,
}

#[derive(Serialize, Clone)]
struct CallEvent {
    id: u64,
    client: String,
    tool: String,
    args: Value,
}

fn serve(app: tauri::AppHandle, listener: TcpListener, token: String, stop: Arc<AtomicBool>) {
    for conn in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(mut stream) = conn else { continue };
        let app = app.clone();
        let token = token.clone();
        std::thread::spawn(move || {
            let Some(req) = read_request(&mut stream) else { return };
            let h = |k: &str| req.headers.get(k).map(|s| s.as_str());
            if let Err(code) = check_request(&req.method, &req.path, h("origin"), h("authorization"), &token) {
                return respond(&mut stream, code, &[], "");
            }
            let Ok(msg) = serde_json::from_slice::<Value>(&req.body) else {
                return respond(&mut stream, 400, &[], &err(&Value::Null, -32700, "Parse error").to_string());
            };
            // a session per client, so suggestions can carry the app's name
            let mut sid = h("mcp-session-id").unwrap_or("").to_string();
            let is_init = msg.get("method").and_then(|m| m.as_str()) == Some("initialize");
            if is_init || sid.is_empty() {
                sid = format!("{:x}{:x}", now_ms(), NEXT_ID.fetch_add(1, Ordering::SeqCst));
            }
            let mut client = sessions().lock().unwrap().get(&sid).cloned().unwrap_or_default();
            let name = if client.name.is_empty() { "AI app".to_string() } else { client.name.clone() };
            let call = |tool: &str, args: Value| -> Result<Value, String> {
                let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
                let (tx, rx) = mpsc::channel();
                pending().lock().unwrap().insert(id, tx);
                let ev = CallEvent { id, client: name.clone(), tool: tool.to_string(), args };
                if app.emit("mcp-call", ev).is_err() {
                    pending().lock().unwrap().remove(&id);
                    return Err("CaretFlow could not handle the request".into());
                }
                let res = rx.recv_timeout(Duration::from_secs(15));
                pending().lock().unwrap().remove(&id);
                res.unwrap_or_else(|_| Err("CaretFlow did not answer in time".into()))
            };
            let answers: Vec<Value> = match &msg {
                Value::Array(batch) => batch.iter().filter_map(|m| handle(m, &mut client, &call)).collect(),
                m => handle(m, &mut client, &call).into_iter().collect(),
            };
            sessions().lock().unwrap().insert(sid.clone(), client);
            let headers = [("Mcp-Session-Id", sid.as_str())];
            match (&msg, answers.len()) {
                (_, 0) => respond(&mut stream, 202, &headers, ""),
                (Value::Array(_), _) => respond(&mut stream, 200, &headers, &Value::Array(answers).to_string()),
                _ => respond(&mut stream, 200, &headers, &answers[0].to_string()),
            }
        });
    }
}

/// Start (or restart) the server on 127.0.0.1:port.
#[tauri::command]
pub fn mcp_start(app: tauri::AppHandle, port: u16, token: String) -> Result<(), String> {
    mcp_stop();
    if token.len() < 16 {
        return Err("the token is too short".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("Port {port} is in use or not allowed ({e}). Choose another port."))?;
    let stop = Arc::new(AtomicBool::new(false));
    *running().lock().unwrap() = Some(Running { port, stop: stop.clone() });
    if let Some(f) = bridge_file() {
        if let Some(d) = f.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(&f, json!({ "port": port, "token": token }).to_string());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
        }
    }
    std::thread::spawn(move || serve(app, listener, token, stop));
    Ok(())
}

#[tauri::command]
pub fn mcp_stop() {
    if let Some(r) = running().lock().unwrap().take() {
        r.stop.store(true, Ordering::SeqCst);
        // wake the accept loop so it sees the stop flag
        let _ = TcpStream::connect(("127.0.0.1", r.port));
        if let Some(f) = bridge_file() {
            let _ = std::fs::remove_file(f);
        }
    }
    sessions().lock().unwrap().clear();
}

/// The frontend's answer to an `mcp-call` event.
#[tauri::command]
pub fn mcp_reply(id: u64, result: Option<Value>, error: Option<String>) {
    if let Some(tx) = pending().lock().unwrap().remove(&id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
}

#[tauri::command]
pub fn mcp_status() -> Status {
    let r = running().lock().unwrap();
    let mut clients: Vec<ClientInfo> = sessions().lock().unwrap().values().filter(|c| !c.name.is_empty()).cloned().collect();
    clients.sort_by(|a, b| b.last_seen_ms.cmp(&a.last_seen_ms));
    clients.dedup_by(|a, b| a.name == b.name);
    Status { running: r.is_some(), port: r.as_ref().map(|x| x.port).unwrap_or(0), clients }
}

// ───────────────────────────── `caretflow --mcp`: stdin/stdout ⇄ the running app

fn post(port: u16, token: &str, session: &str, body: &str) -> Result<(u16, Option<String>, String), String> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let mut head = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if !session.is_empty() {
        head.push_str(&format!("Mcp-Session-Id: {session}\r\n"));
    }
    head.push_str("\r\n");
    s.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    s.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let sid = head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("mcp-session-id")).map(|(_, v)| v.trim().to_string()));
    Ok((status, sid, body.to_string()))
}

pub fn bridge() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut session = String::new();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let id = serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("id").cloned());
        // read the port and token each time: CaretFlow may have started (or got a new token) meanwhile
        let conf = bridge_file().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let answer = match conf {
            Some(c) => {
                let port = c["port"].as_u64().unwrap_or(38457) as u16;
                let token = c["token"].as_str().unwrap_or("");
                match post(port, token, &session, &line) {
                    Ok((200, sid, body)) => {
                        if let Some(s) = sid {
                            session = s;
                        }
                        Some(body.trim().to_string())
                    }
                    Ok((202, sid, _)) => {
                        if let Some(s) = sid {
                            session = s;
                        }
                        None
                    }
                    Ok((code, _, _)) => id.as_ref().map(|i| err(i, -32002, &format!("CaretFlow refused the request (HTTP {code}). Copy the setup from Preferences → AI again.")).to_string()),
                    Err(_) => id.as_ref().map(|i| err(i, -32002, "Open CaretFlow and turn on the MCP server (Preferences → AI)").to_string()),
                }
            }
            None => id.as_ref().map(|i| err(i, -32002, "Open CaretFlow and turn on the MCP server (Preferences → AI)").to_string()),
        };
        if let Some(a) = answer {
            if writeln!(out, "{a}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_call(_: &str, _: Value) -> Result<Value, String> {
        Err("not called".into())
    }
    fn run(req: Value) -> Option<Value> {
        handle(&req, &mut ClientInfo::default(), &no_call)
    }

    #[test]
    fn initialize_echoes_a_supported_version_and_remembers_the_client() {
        let mut c = ClientInfo::default();
        let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"Claude Desktop","version":"1.0"}}});
        let r = handle(&req, &mut c, &no_call).expect("a response");
        assert_eq!(r["id"], 1);
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert!(r["result"]["capabilities"]["prompts"].is_object());
        assert_eq!(r["result"]["serverInfo"]["name"], "CaretFlow");
        assert_eq!(c.name, "Claude Desktop");
    }

    #[test]
    fn initialize_with_an_unknown_version_gets_the_default() {
        let r = run(json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}})).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
    }

    #[test]
    fn notifications_get_no_answer() {
        assert!(run(json!({"jsonrpc":"2.0","method":"notifications/initialized"})).is_none());
    }

    #[test]
    fn ping() {
        let r = run(json!({"jsonrpc":"2.0","id":"p","method":"ping"})).unwrap();
        assert_eq!(r["result"], json!({}));
        assert_eq!(r["id"], "p");
    }

    #[test]
    fn tools_list_has_the_five_tools_with_schemas() {
        let r = run(json!({"jsonrpc":"2.0","id":3,"method":"tools/list"})).unwrap();
        let tools = r["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["get_document", "get_selection", "get_writing_issues", "add_suggestions", "clear_suggestions"]);
        assert!(tools.iter().all(|t| t["inputSchema"]["type"] == "object" && t["description"].is_string()));
    }

    #[test]
    fn prompts() {
        let r = run(json!({"jsonrpc":"2.0","id":4,"method":"prompts/list"})).unwrap();
        assert_eq!(r["result"]["prompts"][0]["name"], "review_document");
        let r = run(json!({"jsonrpc":"2.0","id":5,"method":"prompts/get","params":{"name":"review_document"}})).unwrap();
        let msgs = r["result"]["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["role"], "user");
        assert!(msgs[0]["content"]["text"].as_str().unwrap().contains("add_suggestions"));
        let r = run(json!({"jsonrpc":"2.0","id":6,"method":"prompts/get","params":{"name":"nope"}})).unwrap();
        assert_eq!(r["error"]["code"], -32602);
    }

    #[test]
    fn tools_call_passes_arguments_and_wraps_the_result() {
        let call = |tool: &str, args: Value| -> Result<Value, String> {
            assert_eq!(tool, "add_suggestions");
            Ok(json!({"placed": args["suggestions"].as_array().unwrap().len()}))
        };
        let req = json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"add_suggestions","arguments":{"suggestions":[{"quote":"a","replacement":"b"}]}}});
        let r = handle(&req, &mut ClientInfo::default(), &call).unwrap();
        assert_eq!(r["result"]["content"][0]["type"], "text");
        let inner: Value = serde_json::from_str(r["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(inner["placed"], 1);
        assert_ne!(r["result"]["isError"], true);
    }

    #[test]
    fn tools_call_errors_become_tool_errors() {
        let call = |_: &str, _: Value| -> Result<Value, String> { Err("no document is open".into()) };
        let req = json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"get_document","arguments":{}}});
        let r = handle(&req, &mut ClientInfo::default(), &call).unwrap();
        assert_eq!(r["result"]["isError"], true);
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("no document"));
        let req = json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"delete_everything","arguments":{}}});
        let r = handle(&req, &mut ClientInfo::default(), &call).unwrap();
        assert_eq!(r["result"]["isError"], true);
    }

    #[test]
    fn unknown_method() {
        let r = run(json!({"jsonrpc":"2.0","id":10,"method":"resources/list"})).unwrap();
        assert_eq!(r["error"]["code"], -32601);
    }

    #[test]
    fn requests_are_checked() {
        let ok = |m, p, o, a| check_request(m, p, o, a, "secret");
        assert_eq!(ok("POST", "/mcp", None, Some("Bearer secret")), Ok(()));
        assert_eq!(ok("POST", "/mcp", None, Some("Bearer wrong")), Err(401));
        assert_eq!(ok("POST", "/mcp", None, None), Err(401));
        assert_eq!(ok("POST", "/mcp", Some("https://evil.example"), Some("Bearer secret")), Err(403));
        assert_eq!(ok("POST", "/mcp", Some("http://localhost:3000"), Some("Bearer secret")), Ok(()));
        assert_eq!(ok("GET", "/mcp", None, Some("Bearer secret")), Err(405));
        assert_eq!(ok("POST", "/other", None, Some("Bearer secret")), Err(404));
        assert_eq!(ok("POST", "/mcp?x=1", None, Some("Bearer secret")), Ok(()));
    }
}
