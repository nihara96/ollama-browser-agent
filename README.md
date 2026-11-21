# Ollama Browser Agent

A Chrome extension that lets **local Ollama models** read and operate your browser, plus an **MCP bridge** so tools like
[Continue](https://continue.dev) in VS Code can use your real, logged-in Chrome too.

Everything runs on your machine: the model, the extension and the bridge. No cloud service is involved.

> **Status:** early (v0.1). It works, but small local models are unreliable at long multi-step tasks. See [Limitations](#limitations).

## Features

- **Side-panel chat** with a model dropdown filled from your installed Ollama models.
- **Browser tools** for the model: read the page, click, type, scroll, navigate, open/switch tabs.
- **Compact page view:** a numbered list of interactive elements plus trimmed page text, sized for small context windows.
- **Safety prompts:** risky clicks (submit, buy, delete, send...) and typing with Enter ask for confirmation; optional "confirm every action"; never types into password fields; step limit and Stop button.
- **MCP bridge:** exposes the same tools to any MCP client over stdio, connected with a single button (no token to generate or paste) and a live connection indicator in the side panel.
- **TypeScript** throughout (strict mode), bundled with esbuild; the extension is loaded unpacked.

## How it works

```
Side panel chat ──► Ollama (/api/chat, tool calling) ──► extension tools ──► your tabs

MCP client (Continue, ...) ──stdio──► mcp-bridge/server.js ──WebSocket 127.0.0.1:8765──► extension ──► your tabs
```

| Folder | What it is |
|---|---|
| [`ollama-agent/`](ollama-agent) | The Chrome extension (Manifest V3). Sources in `src/`, built output in `dist/` |
| [`mcp-bridge/`](mcp-bridge) | Node.js MCP server that forwards tool calls to the extension. Sources in `src/`, built output in `dist/` |
| [`shared/`](shared) | Types and the tool/WebSocket protocol shared by both |
| [`scripts/`](scripts) | esbuild build script |

## Requirements

- [Ollama](https://ollama.com) running locally with at least one model that supports tool calling (for example `qwen3.5`).
- Google Chrome (or another Chromium browser with side panel support).
- Node.js 18+ and npm (to build the project and run the MCP bridge).

## Build

```bash
npm install
npm run build
```

This produces `ollama-agent/dist/` (extension scripts) and `mcp-bridge/dist/server.mjs` (bridge server).

## Quick start: side panel agent

1. Make sure Ollama is running: `ollama list`.
2. Build the project (see above).
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the `ollama-agent` folder.
4. Click the extension icon to open the side panel, pick a model and ask it to do something in the current tab.

The extension removes the `Origin` header on requests to `localhost:11434`, so you normally do not need to set `OLLAMA_ORIGINS`.
If you still get HTTP 403, set `OLLAMA_ORIGINS=chrome-extension://*` and restart Ollama.

## MCP bridge (VS Code Continue and other MCP clients)

1. Build the project (`npm install && npm run build`). The server is `mcp-bridge/dist/server.mjs`.
2. Add the server to your MCP client. For Continue, create `.continue/mcpServers/ollama-browser-agent.yaml`
   (see [`mcp-bridge/continue-mcp-server.example.yaml`](mcp-bridge/continue-mcp-server.example.yaml)):
   ```yaml
   name: Ollama Browser Agent
   version: 0.0.1
   schema: v1
   mcpServers:
     - name: Ollama Browser Agent
       command: node
       args:
         - /absolute/path/to/ollama-browser-agent/mcp-bridge/dist/server.mjs
   ```
   No environment variables are required. To use a different port, set `BRIDGE_PORT` in the server's `env`
   and enter the same port in the extension.
3. In the extension side panel open **Settings → MCP bridge** and click **Connect**.
4. The **MCP** pill at the top turns green when a client is connected. Use your client's agent mode with a tool-calling model.

Tools exposed: `get_page`, `click`, `type`, `scroll`, `navigate`, `open_tab`, `list_tabs`, `switch_tab`.

Troubleshooting: the server writes a startup log to `mcp-bridge/dist/bridge.log` (MCP clients often hide stderr).
After rebuilding, restart the MCP server in your client and reload the extension at `chrome://extensions`.

## Security

This project gives a language model control of a browser that may be signed in to your accounts. Treat it accordingly.

- The MCP bridge is **off by default** and only runs after you click **Connect** in the side panel. There is no shared token.
- The bridge server listens on `127.0.0.1` only and accepts WebSocket connections only from `chrome-extension://` origins, so ordinary web pages cannot reach it. Because there is no secret, another process running as you, or another installed Chrome extension, could also connect to the local port while the bridge server is running; it could feed fake page contents to your MCP client but cannot drive your browser. Only install extensions you trust.
- Calls arriving over MCP are **not** confirmed inside the extension. Set `click`, `type`, `navigate` and `open_tab` to "Ask First" in your MCP client.
- Pages can contain text that tries to instruct the model (prompt injection). Do not point the agent at untrusted pages while signed in to sensitive accounts.
- `bridge.log` is git-ignored.

Found a vulnerability? Please open a private security advisory on GitHub instead of a public issue.

## Limitations

- Small models (4B to 9B) often fail at multi-step flows, invent tools that do not exist, or emit malformed tool calls
  (for example Ollama may report `XML syntax error` for Qwen models). Keep tasks short and specific, or use a stronger model.
- Pages are reduced to text plus an element list; there is no vision/screenshot support yet.
- `chrome://` pages and the Chrome Web Store cannot be controlled.
- One MCP client at a time (single port).

## Roadmap ideas

- Screenshot / vision tool for multimodal models
- Retry and repair logic for malformed tool calls
- Per-site allow/deny lists
- Multiple simultaneous MCP clients
- Packaged release for the Chrome Web Store
- Tests for the page-snapshot logic

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss the approach.

Development workflow:

```bash
npm install
npm run watch       # rebuild on change; reload the extension at chrome://extensions after changes
npm run typecheck   # strict TypeScript check for the extension and the bridge
```

Code layout notes:
- Functions in `ollama-agent/src/pageFunctions.ts` are injected into web pages with `chrome.scripting.executeScript`,
  so they are serialized and must be fully self-contained (no imports or outside helpers).
- The WebSocket protocol and tool definitions live in `shared/protocol.ts`; change them there so both sides stay in sync.

## License

[MIT](LICENSE)
