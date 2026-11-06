//! MCP server (AI Writing Help): lets the user's AI app read the open document and send suggestions.
//! Streamable HTTP on 127.0.0.1 only, protected by a token. Tool calls are answered by the frontend
//! (src/mcp.js) through an event round trip; nothing here reads or writes documents.
//! `caretflow --mcp` is a stdin/stdout bridge for apps that only start programs (Claude Desktop).

use serde::Serialize;
use serde_json::{json, Value};

/// MCP protocol versions this server speaks; the first is the default.
pub const PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26"];

#[derive(Default, Clone, Serialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
    pub last_seen_ms: u64,
}

/// Handle one JSON-RPC message. Returns the response, or None for notifications.
/// `call(tool, arguments)` asks the frontend to run a tool.
pub fn handle(_req: &Value, _client: &mut ClientInfo, _call: &dyn Fn(&str, Value) -> Result<Value, String>) -> Option<Value> {
    None
}

/// Checks before a request reaches `handle`: Err(HTTP status) when it must be refused.
pub fn check_request(_method: &str, _path: &str, _origin: Option<&str>, _auth: Option<&str>, _token: &str) -> Result<(), u16> {
    Ok(())
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
