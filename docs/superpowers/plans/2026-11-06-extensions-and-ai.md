# Extensions + AI Writing Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Extensions tab in Preferences that installs/removes Cloud Sync, Typing Test and a new AI Writing Help extension (API-key/self-hosted live checking plus a local MCP server).

**Architecture:** `src/extensions.js` holds the catalog and the installed list; main.js asks it before showing any extension UI, menu item, shortcut or Preferences page. AI lives in lazily loaded `src/ai.js` (providers, limits, checking) and `src/mcp.js` (tool handlers); AI findings enter the existing checker in `src/writing.js` through a new issue-source hook, so underlines, right-click and the F7 panel are shared. Rust gets `src-tauri/src/mcp.rs`: a 127.0.0.1 HTTP listener that speaks MCP JSON-RPC, forwards tool calls to the frontend by event, and a `--mcp` stdio bridge.

**Tech Stack:** Tauri 2 (Rust), plain ES modules, Milkdown/ProseMirror + CodeMirror 6, Vite; tests are scene scripts for `scripts/screenshots.mjs` (Chrome + stubbed backend) and `cargo test` in CI.

**Spec:** `docs/superpowers/specs/2026-11-06-extensions-design.md`, `docs/superpowers/specs/2026-11-06-ai-assist-design.md`

## Global Constraints

- Code style: ES modules, no semicolons, single quotes, 2-space indent, `el()` for DOM, comments explain *why* (AGENTS.md).
- New settings go into `DEFAULTS` in `src/main.js`.
- New UI works in all four themes (CSS variables) and at 640×600.
- Nothing extension-related runs or loads when the extension isn't installed; nothing AI-related touches the network until the user set up a provider or turned on MCP.
- Typing never waits on AI: requests are async, dropped if their block changed.
- No tool and no AI path edits the document or files without the user clicking Apply.
- `npx vite build` passes before every commit; Rust is verified by the Check workflow (`cargo check --locked` and, from Task 8, `cargo test --locked`) on a pushed branch.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `extensions-ai`; push it for CI; merge to main only at the end.

### How tests run here

There is no unit-test runner for the frontend. A test is a scene module (`export const scenes = { name: { open, settings, setup?(page), run(page) } }`) under `scripts/checks/`, run with:

`node scripts/screenshots.mjs <scene> --extra scripts/checks/<file>.mjs --out <scratch dir>`

Each check prints `PASS <name>` or `FAIL <name> — detail`, and the scene ends with `ALL PASSED` or `<n> FAILED`. Expected result = the listed checks print PASS and the last line is `ALL PASSED`. Shared helpers (the `check()` counter, a `backend` object exposed with `page.exposeFunction`, fake HTTP servers) go in `scripts/checks/lib.mjs`, following the Cloud Sync test pattern (`window.__stubExtra` + `scene.setup`).

## Review Focus

1. **Updating from 0.7.0 with Cloud Sync on:** Cloud Sync stays installed, its tab/state/timers work, the typing test is gone, the one-time notice shows once. Test in Task 3.
2. **Removing an extension while it is busy** (a sync running, an AI request in flight, MCP client connected): no errors, timers and the server stop, underlines disappear. Test in Tasks 2, 6, 9.
3. **The model returns junk** (prose instead of JSON, JSON in a ``` fence, a quote not in the text, an empty replacement, an HTTP 429/500): no crash, nothing placed wrongly, a status message, the request still counts toward limits. Test in Task 5.
4. **Typing during a request:** the block changes before the answer arrives → the answer is dropped, no stale underline. Test in Task 5.
5. **A custom shortcut set for an extension command, then the extension removed:** the key does nothing, the binding is kept, reinstall restores it. Test in Task 2.

---

### Task 1: Extensions catalog and installed state

**Files:**
- Create: `src/extensions.js`
- Modify: `src/main.js` (DEFAULTS, MENU items gain `ext`)
- Test: `scripts/checks/lib.mjs`, `scripts/checks/extensions.mjs`

**Interfaces:**
- Produces:
  - `EXTENSIONS: Array<{ id: 'cloud'|'typing'|'ai', name, icon /* inline SVG string */, tagline, description, adds: string[], network: string, shots: string[] /* image URLs */ }>`
  - `isInstalled(settings, id) -> boolean`
  - `setInstalled(settings, id, on: boolean) -> void` (mutates `settings.extensions`, keeps order of EXTENSIONS)
  - Menu items may carry `ext: 'cloud'|'typing'|'ai'`.
- Settings: `extensions: []`, `extNoticeSeen: false`.

- [ ] **Step 1: Write `scripts/checks/lib.mjs`** with `check(name, ok, detail)`, `summary()`, and `stubBackend(page, handlers)` (the exposeFunction + `__stubExtra` init script from the Cloud Sync test, including the `sessionStorage['test.override']` settings merge).
- [ ] **Step 2: Write failing scene `extensions` checks:** `import('/src/extensions.js')` → `EXTENSIONS.map(e => e.id)` deep-equals `['cloud','typing','ai']`; `isInstalled({extensions: []}, 'cloud') === false`; after `setInstalled(s, 'ai', true); setInstalled(s, 'cloud', true)` → `s.extensions` equals `['cloud','ai']`; `setInstalled(s,'cloud',false)` → `['ai']`.
- [ ] **Step 3: Run** `node scripts/screenshots.mjs extensions --extra scripts/checks/extensions.mjs --out %TEMP%\cf-checks` — expect FAIL (module missing).
- [ ] **Step 4: Implement `src/extensions.js`** with the catalog texts from the specs (adds/network lines per the "What not installed removes" table) and the two functions; add `ext` to MENU items: File → Sync Now, View → Cloud Files, Settings → Cloud Sync… (`cloud`); View → Typing Test… (`typing`).
- [ ] **Step 5: Run** — expect the four checks PASS, `ALL PASSED`; `npx vite build` passes.
- [ ] **Step 6: Commit** `Extensions: catalog and installed state`.

### Task 2: Hide everything an extension owns when it isn't installed

**Files:**
- Modify: `src/main.js` (buildPop, palette rows, applyKeybindings, showShortcuts, keyboardPrefs, applyCloudUi, typingTest, openPrefs PAGES, boot), `src/cloud.js` (add `stop()`)
- Test: `scripts/checks/extensions.mjs`

**Interfaces:**
- Consumes: Task 1.
- Produces in main.js: `extOn(id) -> boolean` (= `isInstalled(settings, id)`), `applyExtensions()` (re-renders menubar items, KEYMAP, sidebar tab, status-bar elements, starts/stops extension runtimes), `actions() -> ACTIONS filtered by extOn(a.ext ?? null)`.
- `cloud.js` exports `stop()`: clears the interval, the after-save timer and the `online` listener; a running sync finishes but schedules nothing.

- [ ] **Step 1: Failing checks** (scene with `extensions: []`, `cloudEnabled: true`): no `.menu-item` with text "Sync Now" after opening File; palette query "typing" has no "Typing Test" row; `Ctrl+Alt+T` opens nothing (`#tt` absent); `#tab-cloud` hidden and `#st-cloud` hidden; Preferences nav has no "Cloud Sync". Then set `extensions: ['cloud','typing']` via `settings` + call `applyExtensions()` from the page → all present. Review Focus 5: with `keybindings: {'View/Typing Test…': 'Ctrl+Alt+Y'}` and typing removed, `Ctrl+Alt+Y` does nothing and `settings.keybindings` still has the entry; after install, `Ctrl+Alt+Y` opens the test. Review Focus 2: with Cloud configured against a never-answering stub, remove Cloud mid-sync → no page error, `setInterval` count back to baseline (wrap `setInterval`/`clearInterval` in the scene to count).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the filters (`extOn` checks in buildPop, palette, `applyKeybindings` skips non-installed actions without deleting `settings.keybindings` entries, showShortcuts, keyboardPrefs), gate `applyCloudUi` on `extOn('cloud') && settings.cloudEnabled`, `typingTest()` returns early unless `extOn('typing')`, PAGES omit `cloud` unless installed, `cloudSaved` no-ops unless installed, and `applyExtensions()` calls `cloud.stop()` when Cloud is removed.
- [ ] **Step 4: Run** — expect `ALL PASSED`; run all existing scenes (`node scripts/screenshots.mjs --out <tmp>`) with no page errors.
- [ ] **Step 5: Commit** `Extensions: hide menus, shortcuts, tabs and pages of extensions that aren't installed`.

### Task 3: Preferences → Extensions tab, screenshots, update migration

**Files:**
- Modify: `src/main.js` (PAGES gets `['extensions', 'Extensions', [extensionsPage()]]`, Settings menu `Extensions…`, boot migration), `src/style.css`, `scripts/screenshots.mjs` (scenes that write `public/extensions/*.webp`)
- Create: `public/extensions/` images
- Test: `scripts/checks/extensions.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `extensionsPage() -> HTMLElement` (grid ⇄ detail with ← Back), `openPrefs('extensions')`.

- [ ] **Step 1: Failing checks:** Preferences has an "Extensions" nav entry; the page shows 3 cards with buttons "Install"; clicking Cloud Sync's card (not the button) shows a detail view with ≥2 `img` and a "← Back" button; Install on Typing Test → button says "Remove", View menu has "Typing Test…", settings.extensions includes `typing`; Remove on Cloud Sync while `cloudEnabled` asks a confirm dialog first. Review Focus 1 (migration): scene settings `{ cloudEnabled: true }` with no `extensions` key and `folio.settings` already present (an update) → after boot `extensions` equals `['cloud']`, a notice containing "Settings → Extensions" is shown once, `extNoticeSeen` true; a reload shows no notice. A fresh start (no `folio.settings`) → `extensions` `[]`, no notice.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the page (cards wrap via CSS grid `repeat(auto-fill, minmax(220px, 1fr))`), detail carousel (← → keys and dots), a "Open settings" / "Start" button after install, the Settings menu item `Extensions…` and palette entry, the line "More features: Extensions…" at the top of Preferences → General. Migration in boot: if `!('extensions' in savedSettings) && !FIRST_RUN` → `extensions = settings.cloudEnabled ? ['cloud'] : []` and show the notice via `showNotice` once.
- [ ] **Step 4: Generate screenshots:** scenes `ext-cloud-1/2`, `ext-typing-1/2`, `ext-ai-1/2` (AI ones added in Task 10) saving WebP at 1280×800, quality 70, to `public/extensions/`; each under 100 KB (`ls -l`).
- [ ] **Step 5: Run** checks — `ALL PASSED`; screenshot the tab in paper, ink and at 640×600 and look at them.
- [ ] **Step 6: Commit** `Extensions tab in Preferences; Typing Test and Cloud Sync become extensions`.

### Task 4: AI providers, secrets and limits (`src/ai.js`)

**Files:**
- Create: `src/ai.js`
- Modify: `src-tauri/src/cloud.rs` (rename `cloud_secret_get/set` → `secret_get/set`, file `secrets.json`, read `cloud-secrets.json` as fallback), `src-tauri/src/lib.rs`, `src/cloud.js` (use new names), `src/main.js` DEFAULTS
- Test: `scripts/checks/ai.mjs` with fake OpenAI-compatible and Anthropic servers (node `http.createServer`)

**Interfaces:**
- Produces:
  - `PRESETS: Array<[id, label, { format: 'anthropic'|'openai', base: string, key: boolean }]>` with ids `anthropic, openai, gemini, deepseek, mistral, xai, openrouter, groq, ollama, lmstudio, custom` and bases from the spec (`https://api.anthropic.com/v1`, `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com/v1beta/openai`, `https://api.deepseek.com/v1`, `https://api.mistral.ai/v1`, `https://api.x.ai/v1`, `https://openrouter.ai/api/v1`, `https://api.groq.com/openai/v1`, `http://localhost:11434/v1`, `http://localhost:1234/v1`, custom = `settings.aiBaseUrl`).
  - `complete({ system, user, maxTokens }) -> Promise<{ text, inTokens, outTokens }>` (throws `AiError` with `.status`)
  - `budget() -> { ok: boolean, reason?: 'hour'|'day'|'tokens', resetAt?: number }`, `record(inTokens, outTokens)`, `usage() -> { day, req, reqHour, tokens }`, `resetUsage()`
  - `listModels() -> Promise<string[]>`, `testConnection() -> Promise<{ ok, msg }>`
- Settings (DEFAULTS): `aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '', aiMaxOut: 400, aiMaxChars: 2000, aiPerHour: 30, aiPerDay: 150, aiTokensDay: 100000, aiTemperature: 0.2, aiParallel: 1`. Usage in `localStorage['folio.ai.usage']`. Key in secrets under `ai:<provider>`.

- [ ] **Step 1: Failing checks:** against the fake OpenAI server, `complete` sends `POST /v1/chat/completions` with `Authorization: Bearer k`, `max_tokens: 400`, `temperature: 0.2`, and returns its text and usage; against the fake Anthropic server, `POST /v1/messages` with `x-api-key: k`, `anthropic-version: 2023-06-01`, `system` as a top-level field; `ollama` preset sends no Authorization header; after 30 recorded requests in one hour `budget()` is `{ok:false, reason:'hour'}`; `aiTokensDay: 1000` and `record(900, 200)` → `reason:'tokens'`; a 429 from the server throws `AiError` with `status 429`; `listModels` reads `/models` `data[].id`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** via `invoke('cloud_http', { req })` (as cloud.js does); hour/day windows by local clock.
- [ ] **Step 4: Run** — `ALL PASSED`; rerun the Cloud Sync scene from the previous release's test with the renamed secret commands.
- [ ] **Step 5: Commit** `AI: providers, API keys and request limits`.

### Task 5: AI checking pipeline in the editor

**Files:**
- Modify: `src/writing.js` (issue-source hook, `on()`), `src/ai.js` (checker), `src/style.css` (`--wc-ai` per theme, `.wc-ai-fix` wavy, `.wc-ai-rec` dotted)
- Test: `scripts/checks/ai.mjs`

**Interfaces:**
- Consumes: Task 4 `complete`, `budget`, `record`.
- Produces in writing.js: `registerSource({ id: 'ai', active: () => boolean, issues(blocks, ctx) -> Array<Array<RawIssue>> /* sync, from cache */, wanted(blocks, ctx) -> void /* schedule requests */ })` and `sourceChanged()` (triggers `refresh(0)`). `RawIssue` = engine shape `{ start, end, cat, kind, message, sugg: [{label, text}], rule }` with `cat: 'ai-fix'|'ai-rec'`, `rule: 'ai:<kind>'`, plus `source: 'ai'|'mcp:<client>'`. `ctx = { caretBlock: number, idleMs: number }`.
- Produces in ai.js: `aiSource` (the object above) and `checkBlocks(texts: string[], { feature: 'fix'|'rec'|'both', force }) -> Promise<void>`.
- Settings: `aiEnabled: false, aiFix: true, aiFixWhen: 'leave', aiFixLevel: 'balanced', aiRec: true, aiRecWhen: 'leave', aiRecLevel: 'balanced', aiRecAspects: ['clarity','concise','words'], aiTone: '', aiLanguage: 'auto', aiInstructions: '', aiContext: true, aiPause: 4, aiMinChars: 30`. When: `'leave'|'pause'|'manual'`. Levels: `relaxed|balanced|strict` → max findings 1/3/6.

- [ ] **Step 1: Failing checks** (fake OpenAI server returns scripted JSON):
  - typing "Their going to the park tomorow." then moving the caret to the next block and waiting `aiPause` → one request; the underline `.wc-ai-fix` covers "Their"; right-click shows the replacement "They're" and Apply changes the text.
  - Review Focus 3: server answers `Sure! Here:` + fenced JSON → parsed; answers prose → no underline, status "AI answer could not be read", usage still +1; a finding whose quote isn't in the block → dropped; replacement equal to quote → dropped; 500 → status shows error, no retry loop (exactly 1 request in 5 s).
  - Review Focus 4: server delays 2 s; edit the block during the delay → no underline from the stale answer.
  - code blocks and inline code are never in the request body; blocks under 30 characters are not sent; with `aiContext: true` the previous block is sent as context but no findings land in it.
  - Ignore on a finding → after re-check of the same text, it doesn't come back.
  - `aiFixWhen: 'manual'` → no request while typing.
  - with `spellcheck: false` and AI on → AI underlines still appear; Harper's don't.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the hook in writing.js (merge source issues after `checkTexts`; `on()` = `spellcheck || any active source`; Harper only when `spellcheck`), the prompt builder (system prompt per feature + level + aspects + tone + language + user instructions; asks for `{"findings":[{"quote","replacement","kind","message"}]}`), the JSON extractor (first `{`…last `}` or fenced block), placement (exact, then whitespace-normalised), cache keyed by `block text + JSON of settings that change results` (in memory, plus `localStorage['folio.ai.cache']` capped at 500 entries), ignored set persisted in `localStorage['folio.ai.ignored']`, and the scheduler (one queue, `aiParallel` concurrency, `budget()` checked before each send).
- [ ] **Step 4: Run** — `ALL PASSED`; check the underline colour in all four themes.
- [ ] **Step 5: Commit** `AI: live checking of finished paragraphs, shown in the existing checker`.

### Task 6: F7 panel tabs, status, right-click extras

**Files:**
- Modify: `src/writing.js` (panel tabs, menu hook), `src/ai.js`, `src/style.css`
- Test: `scripts/checks/ai.mjs`

**Interfaces:**
- Consumes: Task 5.
- Produces: `openPanel(id, tab?: 'wc'|'ai')`, exported `openAiPanel()`; menu hook `source.menuExtras(issue) -> Array<[label, fn]>` (AI adds "Ignore this kind of suggestion", "Explain more").

- [ ] **Step 1: Failing checks:** F7 shows tabs "Spelling & Grammar" and "AI" with counts; AI tab lists AI and MCP findings, Apply/Ignore/Next work, "Check paragraph" sends one request, "Check whole document" on a 12-block doc shows a confirm with "12 requests" before sending; usage line reads "Today: N requests, M tokens"; when `budget()` fails the tab shows "Paused: daily limit reached" with "Check anyway" that sends exactly one request; "Explain more" sends one request with the finding and shows its text; "Ignore this kind of suggestion" removes `tone` from `aiRecAspects` for a `kind: 'tone'` finding. Review Focus 2: turn AI off (remove the extension) with a request in flight → all `.wc-ai-*` gone, no page error.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; the status-bar writing counter includes AI findings; a small marker in `#st-wc` title text for "AI checking…", "AI paused", errors.
- [ ] **Step 4: Run** — `ALL PASSED`.
- [ ] **Step 5: Commit** `AI: tab in the review panel, usage and limits in view`.

### Task 7: Preferences → AI, menus, setup guide

**Files:**
- Modify: `src/main.js` (PAGES `ai`, MENU items with `ext: 'ai'`: Edit → AI: Check Paragraph `Ctrl+Alt+K`, AI: Check Document, AI: Next Suggestion `Shift+Alt+F7`; Help → AI Setup Guide), `src/ai.js` (`prefsPage(row)`), `src/style.css`
- Create: `docs/MCP.md` (bundled with `?raw`)
- Test: `scripts/checks/ai.mjs`

**Interfaces:**
- Consumes: Tasks 4–6; `openBuiltin(md)` from main.js.
- Produces: `openSetupGuide()` in ai.js: fetch `https://raw.githubusercontent.com/Sooeeren/CaretFlow/main/docs/MCP.md` via `cloud_http` (timeout 8 s); on any failure open the bundled copy; settings `aiGuideBanner: true`.

- [ ] **Step 1: Failing checks:** Preferences → AI page sections in spec order (banner, on/off, Connection, AI spelling & grammar, Recommendations, Both, Limits & usage, MCP server); banner "Need help setting up MCP?" → click → the editor shows a doc whose first heading is "# Set up MCP"; with `cloud_http` stub failing → same heading (bundled copy); dismissing the banner sets `aiGuideBanner: false` and Help → AI Setup Guide still opens it; switching provider to `ollama` hides the API key row and shows Base URL; Test connection against the fake server shows the model name; `aiEnabled` stays false until turned on and no request is made before.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the page with the same control helpers as `cloud.js` (`text`, `check`, `pick`, `secret`), numeric inputs for limits with min/max (`aiMaxOut` 50–4000, `aiMaxChars` 200–20000, `aiPerHour` 1–1000, `aiPerDay` 1–10000, `aiTokensDay` 1000–10,000,000, `aiPause` 2–30, `aiTemperature` 0–1). Write `docs/MCP.md` (user-facing guide: what MCP gives vs an API key; Claude Desktop, Claude Code, Cursor, VS Code, Gemini CLI steps with snippets; starting a review with the `review_document` prompt; ChatGPT note; troubleshooting: port in use, token, firewall).
- [ ] **Step 4: Run** — `ALL PASSED`; screenshot the page in sepia and slate.
- [ ] **Step 5: Commit** `AI: Preferences page, menus and the MCP setup guide`.

### Task 8: MCP server in Rust

**Files:**
- Create: `src-tauri/src/mcp.rs`
- Modify: `src-tauri/src/lib.rs` (commands, `--mcp` early exit in `run()`), `src-tauri/Cargo.toml` (`tiny_http = "0.12"`), `Cargo.lock`, `.github/workflows/check.yml` (add `cargo test --locked`)
- Test: `#[cfg(test)] mod tests` in `mcp.rs`

**Interfaces:**
- Produces (Tauri commands): `mcp_start(port: u16, token: String) -> Result<(), String>`, `mcp_stop()`, `mcp_reply(id: u64, result: serde_json::Value, error: Option<String>)`, `mcp_status() -> { running: bool, port: u16, clients: Vec<{ name, version, last_seen_ms }> }`.
- Event to the frontend: `mcp-call` with payload `{ id: u64, client: String, tool: String, args: Value }`; the frontend answers with `mcp_reply` within 15 s (else JSON-RPC error `-32001 "CaretFlow did not answer"`).
- Pure function for tests: `handle(req: Value, client: &mut ClientInfo, call: &dyn Fn(&str, Value) -> Result<Value, String>) -> Option<Value>`.
- File `<config dir>/mcp.json` = `{ "port": u16, "token": String }` written on start, removed on stop (read by the bridge).
- Bridge: `caretflow --mcp` reads JSON-RPC lines from stdin, POSTs each to `http://127.0.0.1:<port>/mcp` with `Authorization: Bearer <token>` (plain `std::net::TcpStream`, HTTP/1.1, `Connection: close`), writes response bodies as single lines to stdout, prints nothing for notifications; if CaretFlow isn't running, answers requests with error `-32002 "Open CaretFlow and turn on the MCP server (Preferences → AI)"`.

- [ ] **Step 1: Failing Rust tests:** `initialize` → result has `protocolVersion` equal to the request's when it is `2025-06-18` or `2025-03-26` (else `2025-06-18`), `capabilities.tools` and `capabilities.prompts`, `serverInfo.name == "CaretFlow"`, and stores `clientInfo.name`; `notifications/initialized` → `None`; `ping` → `{}`; `tools/list` → names exactly `get_document, get_selection, get_writing_issues, add_suggestions, clear_suggestions`, each with an `inputSchema` object; `prompts/list` → `review_document`; `prompts/get review_document` → one user message whose text contains `add_suggestions`; `tools/call add_suggestions` passes `args` to `call` and wraps its Value as `{ content: [{ type: "text", text: <json> }] }`; `call` error → result with `isError: true`; unknown method → error `-32601`. HTTP layer: a request without the right bearer token → 401; any request with an `Origin` header → 403; `GET /mcp` → 405.
- [ ] **Step 2: Push the branch; Check fails** (`cargo test` can't find `handle`).
- [ ] **Step 3: Implement** `mcp.rs` (listener thread on `127.0.0.1:<port>` only; one `std::sync::mpsc` reply channel per call id in a `Mutex<HashMap>`), the commands, and the bridge (`run()` checks `std::env::args().any(|a| a == "--mcp")` before building Tauri).
- [ ] **Step 4: Push; Check passes** on Windows and Linux (`cargo check` + `cargo test`).
- [ ] **Step 5: Commit** `MCP server: CaretFlow as a local MCP server for AI apps`.

### Task 9: MCP tools in the frontend

**Files:**
- Create: `src/mcp.js`
- Modify: `src/ai.js` (MCP section of the prefs page: on/off, port, token show/copy/regenerate, config snippets, clients), `src/main.js` (expose doc/selection getters to mcp.js), `src/writing.js` (accept `source: 'mcp:<client>'` findings)
- Test: `scripts/checks/mcp.mjs` (emits fake `mcp-call` events through the stub's event plugin and captures `mcp_reply` invokes)

**Interfaces:**
- Consumes: Task 8 event/commands; Task 5 source hook.
- Produces: `startMcp()`, `stopMcp()`, tool handlers `get_document() -> { path, title, markdown, selection: { from, to, text } }`, `get_selection() -> { text, block }`, `get_writing_issues() -> [{ quote, kind, message }]`, `add_suggestions({ suggestions: [{ quote, replacement, message, kind }] }) -> { placed: n, skipped: n }`, `clear_suggestions() -> { removed: n }`.
- Settings: `mcpEnabled: false, mcpPort: 38457`; token in secrets under `mcp:token` (32 random bytes, hex, from `crypto.getRandomValues`).

- [ ] **Step 1: Failing checks:** `get_document` replies with the open file's markdown; `add_suggestions` with 2 suggestions (one quote present, one not) → `{placed:1, skipped:1}`, a `.wc-ai-rec` underline appears and the AI tab shows it labelled with the client's name; `clear_suggestions` removes only that client's; the first call from a new client shows a notice "Claude Desktop connected over MCP" with Disconnect; no handler writes to the document (`markdown` unchanged after all calls); the snippets for Claude Desktop contain the absolute exe path and `"--mcp"`; regenerate token calls `mcp_stop` then `mcp_start` with a new token. Review Focus 2: removing the extension calls `mcp_stop` and clears MCP findings.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; exe path from a new tiny Rust command `exe_path() -> String` (add in this task, in lib.rs).
- [ ] **Step 4: Run** — `ALL PASSED`; push; Check passes.
- [ ] **Step 5: Commit** `MCP: tools for reading the document and sending suggestions`.

### Task 10: Docs, screenshots, README

**Files:**
- Create: `docs/AI.md`, `docs/EXTENSIONS.md`
- Modify: `README.md` (remove the Typing test section and its screenshots; add "Extensions" section listing Cloud Sync, Typing Test, AI Writing Help with one line each; shorten Cloud Sync to its line + link; Highlights: typing test line → extensions line), `docs/FEATURES.md` (typing test stays there, marked as an extension), `docs/SHORTCUTS.md` (mark extension shortcuts, add `Ctrl+Alt+K`, `Shift+Alt+F7`), `docs/NOTES.md` (privacy: AI providers, MCP localhost + token), `docs/CLOUD-SYNC.md` (install it from Extensions first), `src/guide.md`, `src/welcome.md` (mention Settings → Extensions), `AGENTS.md` (map rows for extensions.js, ai.js, mcp.js, mcp.rs, scripts/checks/; "Adding an extension" paragraph; contributor row)
- Screenshots: `public/extensions/ext-ai-1.webp`, `ext-ai-2.webp`; `docs/screenshots/extensions.png` for the README

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Generate** screenshots (`node scripts/screenshots.mjs ext-ai-1 ext-ai-2 extensions`).
- [ ] **Step 3: Verify** every relative link in README and docs/ resolves (`node -e` script that checks `](path)` targets exist); `npx vite build` passes; all scenes run without page errors; all `scripts/checks/*.mjs` print `ALL PASSED`.
- [ ] **Step 4: Commit** `Docs: Extensions, AI writing help and MCP`; push branch; Check passes; fast-forward `main`.
