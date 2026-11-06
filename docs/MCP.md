# Set up MCP

MCP lets the AI app you already use, such as Claude Desktop, Claude Code, Cursor, VS Code or Gemini CLI, read the document open in CaretFlow and send corrections and suggestions back. They show up as violet underlines and in the **AI** tab of the review panel (`F7`), where you apply or ignore each one. The AI app can't change your document or your files by itself.

> [!NOTE]
> **MCP or an API key?** MCP uses your AI app and its subscription, and works when you ask: "check my CaretFlow document". For checking *while you type*, use an API key or a local model instead (Preferences → AI → Connection). You can use both.

## 1. Turn on the MCP server

1. **Preferences → Extensions**: install **AI Writing Help** if you haven't.
2. **Preferences → AI → MCP server**: turn on **Run the MCP server**.
3. Keep that page open: it shows the **address** (normally `http://127.0.0.1:38457/mcp`), your **token**, and a ready-made setup for each app below, with your token and the path to CaretFlow already filled in. Use **Copy** next to the one you need.

The server only listens on this computer (`127.0.0.1`) and only answers apps that send your token. It runs while CaretFlow is open.

## 2. Connect your AI app

### Claude Desktop

Claude Desktop starts CaretFlow's small MCP bridge itself.

1. In Claude Desktop: **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`.
2. Paste the **Claude Desktop** setup from Preferences → AI. It looks like this:

```json
{
  "mcpServers": {
    "caretflow": {
      "command": "C:\\Program Files\\CaretFlow\\caretflow.exe",
      "args": ["--mcp"]
    }
  }
}
```

3. Save and restart Claude Desktop. CaretFlow appears under the tools (🔨) icon.

If the file already has `mcpServers`, add the `"caretflow": { … }` part inside it.

### Claude Code

Run this once in a terminal (Preferences → AI has it with your token):

```
claude mcp add --transport http caretflow http://127.0.0.1:38457/mcp --header "Authorization: Bearer YOUR-TOKEN"
```

### Cursor

**Settings → MCP → Add new MCP server**, or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "caretflow": {
      "url": "http://127.0.0.1:38457/mcp",
      "headers": { "Authorization": "Bearer YOUR-TOKEN" }
    }
  }
}
```

### VS Code (GitHub Copilot)

Run **MCP: Add Server** from the command palette, or add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "caretflow": {
      "type": "http",
      "url": "http://127.0.0.1:38457/mcp",
      "headers": { "Authorization": "Bearer YOUR-TOKEN" }
    }
  }
}
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "caretflow": {
      "httpUrl": "http://127.0.0.1:38457/mcp",
      "headers": { "Authorization": "Bearer YOUR-TOKEN" }
    }
  }
}
```

### Other apps

Any app that supports MCP over HTTP ("Streamable HTTP") works with the address and the header `Authorization: Bearer YOUR-TOKEN`. Apps that can only start a program use `caretflow --mcp`, like Claude Desktop.

**ChatGPT:** the ChatGPT app only connects to MCP servers on the internet, not to programs on your computer, so it can't reach CaretFlow. Use ChatGPT models with an OpenAI API key instead (Preferences → AI → Connection).

## 3. Ask for a review

Open the document in CaretFlow, then ask in your AI app, for example:

- "Check my CaretFlow document for spelling and grammar."
- "Review the selected text in CaretFlow and suggest clearer wording."
- In apps that show MCP prompts (Claude Desktop: the **+** menu), pick **review_document**.

The suggestions appear in CaretFlow right away, labelled with the app's name. Go through them with `F7` → **AI**, or right-click an underline.

The first time an app connects, CaretFlow says so in a bar at the top, with **Disconnect** if you didn't expect it.

## What the AI app can do

| Tool | What it does |
| --- | --- |
| `get_document` | Reads the open document (Markdown), its file name and your selection |
| `get_selection` | Reads the selected text and the paragraph around it |
| `get_writing_issues` | Reads what CaretFlow's own spelling check found, so it doesn't repeat it |
| `add_suggestions` | Sends suggestions: CaretFlow underlines them and lists them in the AI tab |
| `clear_suggestions` | Removes the suggestions this app sent |

None of them change your document or any file.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The app says it can't connect | Is CaretFlow open, and **Run the MCP server** on? |
| "401" or "unauthorized" | The token changed (**New token** in Preferences). Copy the setup again |
| "Port in use" in Preferences | Another program uses 38457: pick another port, then copy the setup again |
| Claude Desktop shows no CaretFlow tools | Check the path in `command`, save the file, restart Claude Desktop completely |
| A firewall asks about CaretFlow | The server only listens on this computer; allowing "private networks" is enough |

More about the AI settings: Preferences → AI, and `docs/AI.md` in the CaretFlow repository.
