# Ollama Browser Agent (Chrome extension)

Manifest V3 extension written in TypeScript.

- `src/sidepanel.ts`: side panel chat UI and agent loop (talks to Ollama)
- `src/background.ts`: service worker (Ollama header rule, MCP bridge client)
- `src/bridge.ts`: WebSocket client for the MCP bridge
- `src/executor.ts`: browser tool execution (shared by the side panel and the bridge)
- `src/pageFunctions.ts`: functions injected into web pages (must stay self-contained)
- `dist/`: built output referenced by `manifest.json` and `sidepanel.html` (generated, git-ignored)

Build from the repository root (`npm install && npm run build`), then load this folder with
**Load unpacked** at `chrome://extensions`. See the [root README](../README.md) for full instructions.
