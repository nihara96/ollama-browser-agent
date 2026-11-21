# MCP bridge

TypeScript MCP server that lets MCP clients (VS Code Continue, etc.) use your real Chrome through the extension.

```
MCP client --stdio--> dist/server.mjs --WebSocket 127.0.0.1:8765--> Chrome extension --> your tabs
```

- Source: [`src/server.ts`](src/server.ts), protocol types in [`../shared/protocol.ts`](../shared/protocol.ts).
- Build from the repository root: `npm install && npm run build` (output: `dist/server.mjs`).
- Setup instructions, security notes and tool list are in the [root README](../README.md).
- Example Continue config: [`continue-mcp-server.example.yaml`](continue-mcp-server.example.yaml).
- Startup log: `dist/bridge.log`.

Environment variables: `BRIDGE_TOKEN` (required, 12+ characters) and `BRIDGE_PORT` (default `8765`).
