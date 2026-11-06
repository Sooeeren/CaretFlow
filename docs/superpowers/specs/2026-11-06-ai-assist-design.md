# AI writing help: design

Status: approved 2026-11-06 · ships as an extension (see [Extensions](2026-11-06-extensions-design.md)): everything below exists only while AI Writing Help is installed

## Intent

Let people use the AI they already have, cloud or self-hosted, to check and improve their writing in
CaretFlow, in two ways:

1. **Live, through an API key or a self-hosted model.** CaretFlow talks to the model itself and
   shows corrections and recommendations as you write.
2. **On demand, through MCP.** CaretFlow becomes an MCP server. Your AI app (Claude Desktop,
   Cursor, VS Code, Claude Code, Gemini CLI, LM Studio, …) connects to it, reads the open document
   when you ask it to, and sends suggestions back into CaretFlow. This uses your existing
   subscription instead of a pay-per-use key.

Why both: an API key is the only way to get live checking while you type. MCP covers people who
pay for an AI app and don't want a second bill. MCP clients call into programs; they don't lend
their model to them, so MCP can't drive live checking.

## Goals

- Providers: Anthropic (Claude), OpenAI (ChatGPT models), Google Gemini, DeepSeek, Mistral, xAI,
  OpenRouter, Groq, and any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM, LocalAI.
- Two features with **separate settings**:
  - **AI spelling & grammar**: errors the offline checker misses (wrong word in context, meaning,
    agreement across a sentence, any language the model knows).
  - **Recommendations**: clearer wording, tone, conciseness, word choice, sentence structure.
- **The user controls every request.** When it checks, how much it sends, how much the model may
  answer, how many requests and tokens per hour and day, sensitivity, model, temperature, and
  their own instructions.
- **Careful by default.** Few, small requests, low caps, usage visible.
- **Same UI as today's checker.** AI findings use the existing underlines, right-click menu and the
  F7 review panel, which gets two tabs: **Spelling & Grammar** (Harper/LanguageTool, unchanged)
  and **AI**.
- A **Preferences → AI** page, separate from Writing, with a **"Need help setting up MCP?"** banner
  at the top that opens the setup guide (`docs/MCP.md` from the GitHub repo) as a document in
  CaretFlow.

## Non-goals

- No chat sidebar, no "write for me" or autocomplete, no generating text beyond fixes for what you
  wrote.
- No AI that edits the document by itself. Every change, from the API or from MCP, is a suggestion
  you apply or ignore.
- No CaretFlow account, proxy, shared key or server. Requests go straight from your computer to
  the provider you chose.
- Doesn't replace Harper/LanguageTool. They stay the instant, offline layer.

## Anti-goals (failure even if it works)

- Typing lags or stutters because of AI requests.
- A surprise bill: requests going out faster or larger than the user set.
- Text leaving the computer without the user having set it up, or going anywhere but the chosen
  provider or a local MCP client.
- The document changing without the user clicking Apply.
- Noise: dozens of nitpicks per paragraph, or the same suggestion again after it was ignored.

## How it works

### Providers (`src/ai.js`, lazy, loaded only when AI is on)

Two request formats cover everything:

- **Anthropic Messages API** for Claude.
- **OpenAI Chat Completions** for everyone else. Presets fill in the base URL: OpenAI, Gemini
  (`generativelanguage.googleapis.com/v1beta/openai/`), DeepSeek, Mistral, xAI, OpenRouter, Groq,
  Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), plus "Custom
  (OpenAI-compatible)" with any URL.

Requests go through the Rust `cloud_http` command from Cloud Sync (no CORS limits, same TLS setup).
API keys are stored like Cloud Sync passwords, in `cloud-secrets.json` (the commands get a more
general name, e.g. `secret_get` / `secret_set`, and Cloud Sync moves to them). A local server needs
no key. **Test connection** sends one tiny request and shows the model's name and the tokens used.
The model list is fetched (`/models`) where the provider offers it; the model can always be typed.

### What is sent, and when

- Text is split with the existing `mdBlocks` (paragraphs, headings, list items, table cells). Code,
  math and front matter are never sent.
- **Unit = one block**, plus the block before it as context (setting, on by default), never the
  whole file unless the user clicks **Check whole document**.
- Results are cached by (block text + settings that affect results), in memory and in a small
  persistent cache, so reopening a file or undoing an edit costs nothing.
- Only blocks whose text changed are sent. Blocks shorter than a minimum (default 30 characters)
  are skipped.

**When to check** (one setting for each feature):

| Option | Meaning |
| --- | --- |
| When I leave a paragraph (**default**) | The paragraph you just finished, after the caret moves to another block and you've been idle for the pause time |
| After a pause | The paragraph being edited, once you stop typing for the pause time (default 4 s, range 2–30 s) |
| Only when I ask | F7 → AI → Check paragraph / Check whole document, or the command `AI: Check Paragraph` |

### Limits (all user-set; defaults are careful)

| Setting | Default |
| --- | --- |
| Max output tokens per request | 400 |
| Max text per request | 2,000 characters (longer blocks are checked only when asked) |
| Requests per hour | 30 |
| Requests per day | 150 |
| Tokens per day (input + output) | 100,000 |
| Temperature | 0.2 |
| Parallel requests | 1 |

When a limit is reached, live checks pause until the next hour or day. The status bar and the AI
tab say so and offer "Check anyway" for one request. Usage (requests and tokens today, using the
provider's reported counts) is shown on the Preferences page and in the AI tab, with a reset time.
A rough cost estimate is out of scope: prices change too often.

### Sensitivity and instructions

- **Sensitivity**, per feature: *Relaxed* (only clear mistakes / only strong improvements),
  *Balanced* (default), *Strict* (everything worth mentioning). It changes the instructions and the
  maximum findings per paragraph (1 / 3 / 6).
- **Recommendations look for:** clarity, conciseness, tone, word choice, sentence structure,
  consistency (each on/off; default: clarity, conciseness, word choice).
- **Tone target** (optional): neutral, formal, friendly, academic, technical.
- **Language**: "same as the text" (default) or a fixed one; British/American follows the Writing
  setting when English.
- **Your instructions** (free text, e.g. "British spelling, I use the Oxford comma, never suggest
  removing 'very' in dialogue") are added to every request.

The model answers with JSON: a list of `{ quote, replacement, kind, message }`. CaretFlow finds
`quote` in the block (exact match, falling back to normalized whitespace) and drops findings it
can't place, findings that change nothing, and findings in code or links. Ignored findings are
remembered per block text, so the same suggestion doesn't come back.

### In the editor

- AI findings get their own underline: a soft violet, dotted for recommendations and wavy for
  AI spelling/grammar, defined per theme (`--wc-ai`). They work in both the rendered view and
  source mode, like the existing ones.
- **Right-click** an AI underline: the replacement (click to apply), the reason in one line,
  *Ignore*, *Ignore this kind of suggestion* (turns that kind off), *Explain more* (one extra
  request, only when clicked).
- **F7 panel** gets tabs: **Spelling & Grammar** (as today) and **AI**. The AI tab shows AI
  findings and MCP suggestions one at a time with Apply / Ignore / next, plus **Check paragraph**,
  **Check whole document** (shows how many requests and roughly how many tokens it will use, and asks
  first above a threshold), usage today, and a provider/model line.
- **Status bar**: the existing writing counter also counts AI findings; a small marker shows
  "AI checking…", "AI paused (daily limit)", or an error. Hover gives details.
- Turning AI off removes all AI underlines at once.

### MCP server

- **Off by default**, its own switch on the AI page. Runs only while CaretFlow is open.
- Transport: Streamable HTTP on `127.0.0.1` (default port 38457, changeable), protected by a
  random token that Preferences shows and can regenerate. Never listens on other interfaces.
- For clients that only start local programs (Claude Desktop), the CaretFlow binary gets a bridge
  mode, `caretflow --mcp`, which talks MCP over stdin/stdout and forwards to the running app. The
  Preferences page shows ready-to-copy config snippets for Claude Desktop, Claude Code, Cursor,
  VS Code and Gemini CLI, with the right path to the CaretFlow executable filled in.
- **Tools:**
  - `get_document`: the open document's Markdown, file name, and selection
  - `get_selection`: the selected text and the block around it
  - `get_writing_issues`: what the offline checker found (so the AI doesn't repeat it)
  - `add_suggestions`: a list of `{ quote, replacement, message, kind }`; they appear in the AI tab
    and as underlines, labelled with the client's name
  - `clear_suggestions`: remove the suggestions this client added
- **Prompt:** `review_document`, "Review the open CaretFlow document for spelling, grammar and
  clarity, and send your suggestions with add_suggestions", so users can start with one click in
  clients that show MCP prompts.
- No tool can write to the document or to files. Applying stays with the user.
- The first time a client connects, CaretFlow shows a notice ("Claude Desktop connected over
  MCP") with a Disconnect button. A list of recent clients is on the AI page.
- ChatGPT's desktop app only connects to remote MCP servers on the internet, so it isn't supported
  through MCP. ChatGPT models work through an OpenAI API key instead. The guide says so.

### Preferences → AI

Top to bottom:

1. Banner: **Need help setting up MCP?** · *Open the setup guide*. It opens `docs/MCP.md`,
   fetched from `raw.githubusercontent.com/Sooeeren/CaretFlow/main/docs/MCP.md` so it is always
   current, as an unsaved document in CaretFlow (like the Markdown Guide). The fetch happens only on
   click. A copy bundled with the app is shown when offline. The banner can be dismissed and comes
   back through Help → AI Setup Guide.
2. **Turn on AI writing help** (off by default), with a line on where text goes.
3. **Connection**: provider preset, base URL (custom and local only), API key, model, Test
   connection.
4. **AI spelling & grammar**: on/off, when to check, sensitivity.
5. **Recommendations**: on/off, when to check, sensitivity, what to look for, tone target.
6. **Both**: language, your instructions, include the paragraph before.
7. **Limits & usage**: all limits above, today's usage, reset usage counter.
8. **MCP server**: on/off, port, token (show, copy, regenerate), config snippets, connected
   clients.

Menus and palette: Edit → AI: Check Paragraph, AI: Check Document, AI: Next Suggestion; Settings →
AI Writing Help (on/off); Help → AI Setup Guide. Default shortcuts: `Ctrl+Alt+K` check paragraph,
`Shift+Alt+F7` next AI suggestion.

### Docs

- `docs/MCP.md` (the in-app guide): what MCP gives you vs an API key, step-by-step setup for each
  client with the snippet, how to start a review, troubleshooting (port in use, token, firewall).
  Written to be read inside CaretFlow (short sections, headings, copyable blocks).
- `docs/AI.md`: providers and keys, local models, every setting, limits, privacy.
- README: a short "AI writing help" section; `docs/SHORTCUTS.md`, `docs/NOTES.md` (privacy),
  `src/guide.md`, AGENTS.md map.

## Constraints

- Plain JS frontend, no framework; `ai.js` and the MCP UI load lazily, only when AI is on or the
  page is opened. Nothing AI-related runs at startup when it's off.
- Typing never waits on AI: requests are async, cancelled when the block changes, and results for a
  block that changed in the meantime are dropped.
- Works in all four themes and small windows; Windows and Linux.
- Private by default (AGENTS.md goal 2): no network until the user sets it up, and every place
  that sends text names where it goes.
- Rust changes stay small: the MCP HTTP listener (a small HTTP crate such as `tiny_http`, or
  tokio), the `--mcp` stdio bridge, and generalized secret storage. The frontend answers MCP tool
  calls through a Tauri event round trip.

## Calls I made (check these)

- Default trigger is "when I leave a paragraph" with a pause. Live, but only finished paragraphs.
- Default caps: 400 output tokens, 2,000 characters, 30 requests/hour, 150/day, 100k tokens/day.
- Recommendations default to clarity, conciseness and word choice; tone off.
- MCP suggestions only; no tool edits the document.
- The setup guide is fetched from GitHub on click, with a bundled offline copy.
- ChatGPT goes through an API key, not MCP (its app can't reach a local MCP server).
- Port 38457 and a token for the local MCP server.

## Left to the builder

Prompt wording, the JSON schema details and retry on malformed answers, the cache size, exact
colors, how the token is passed (header vs query), and the HTTP crate.
