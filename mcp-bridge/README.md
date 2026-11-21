# MCP bridge for the Ollama Browser Agent extension

Lets MCP clients (VS Code Continue, etc.) use your real Chrome through the extension.

```
Continue  --MCP/stdio-->  server.js  --WebSocket 127.0.0.1:8765-->  Chrome extension  -->  your tabs
```

## Setup
1. Make a token (12+ characters):
   `-join ((48..57)+(97..122) | Get-Random -Count 24 | % {[char]$_})`
2. Copy `continue-mcp-server.example.yaml` into your workspace's `.continue/mcpServers/` and put the token in `BRIDGE_TOKEN`.
3. Reload the `ollama-agent` extension at `chrome://extensions`.
4. In the extension side panel open **MCP bridge**, tick the checkbox, paste the same token.
   The status should read `connected` once Continue has started the server.
5. In Continue use **Agent** mode with a model that supports tool calling.

## Tools
get_page, click, type, scroll, navigate, open_tab, list_tabs, switch_tab.

## Safety
- The bridge is off until you tick the checkbox, and needs the token.
- The server listens on 127.0.0.1 only and rejects browser pages (only chrome-extension origins).
- Set `click`, `type`, `navigate` and `open_tab` to "Ask First" in Continue's Tools panel: the extension does
  not show its own confirmations for bridge calls, and these tools act inside your logged-in sessions.
- Only one MCP client at a time (one port). Change BRIDGE_PORT and the panel's Port to run another.
