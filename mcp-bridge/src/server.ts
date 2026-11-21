// MCP server (stdio) <-> WebSocket <-> Ollama Browser Agent Chrome extension.
//
// An MCP client (Continue, etc.) launches this process and speaks MCP over stdin/stdout.
// The Chrome extension connects to ws://127.0.0.1:PORT and executes the browser tool calls.
// IMPORTANT: stdout belongs to MCP. Log to stderr (and bridge.log) only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import {
  DEFAULT_BRIDGE_PORT,
  TOOL_DESCRIPTIONS,
  type ExtensionMessage,
  type ServerMessage,
  type ToolName,
} from "../../shared/protocol";

const PORT = Number(process.env.BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
const CALL_TIMEOUT_MS = 45_000;

// Log to stderr (stdout is MCP) and to bridge.log next to the bundle, because MCP clients often hide stderr.
const LOG_FILE = fileURLToPath(new URL("./bridge.log", import.meta.url));
function log(...parts: unknown[]): void {
  console.error("[bridge]", ...parts);
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${parts.join(" ")}\n`);
  } catch {
    /* logging must never crash the server */
  }
}
process.on("uncaughtException", (e) => log("uncaughtException:", e instanceof Error ? (e.stack ?? e.message) : e));
process.on("unhandledRejection", (e) => log("unhandledRejection:", e instanceof Error ? (e.stack ?? e.message) : e));

log(
  `starting; node ${process.version}; cwd=${process.cwd()}; port=${PORT}; SystemRoot=${process.env.SystemRoot ?? "(missing)"}`,
);

// ---------- WebSocket side (extension) ----------
interface Pending {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let ext: WebSocket | null = null; // connected extension socket
let nextId = 1;
const pending = new Map<number, Pending>();

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  // No shared secret: only a Chrome extension origin may connect. Ordinary web pages (http/https origins)
  // and clients that send no Origin header at all are rejected.
  verifyClient: ({ origin }: { origin: string }) => Boolean(origin) && origin.startsWith("chrome-extension://"),
});
wss.on("listening", () => log(`listening on ws://127.0.0.1:${PORT}`));
wss.on("error", (e: Error) => log("websocket server error:", e.message));

function sendTo(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws: WebSocket) => {
  let greeted = false;
  const timer = setTimeout(() => {
    if (!greeted) ws.close();
  }, 5000);

  ws.on("message", (data) => {
    let m: ExtensionMessage;
    try {
      m = JSON.parse(data.toString()) as ExtensionMessage;
    } catch {
      return;
    }
    if (!greeted) {
      if (m.type === "hello") {
        greeted = true;
        clearTimeout(timer);
        if (ext && ext !== ws) ext.close();
        ext = ws;
        sendTo(ws, { type: "welcome" });
        log("extension connected");
      } else {
        ws.close();
      }
      return;
    }
    if (m.type === "result") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || "Tool failed"));
    }
    // "ping" messages need no reply.
  });

  ws.on("close", () => {
    clearTimeout(timer);
    if (ext === ws) {
      ext = null;
      log("extension disconnected");
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Extension disconnected"));
        pending.delete(id);
      }
    }
  });
});

function callExtension(tool: ToolName, args: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ext || ext.readyState !== ext.OPEN) {
      reject(
        new Error(
          "The Chrome extension is not connected. Open the Ollama Agent side panel, expand Settings, and click Connect under MCP bridge.",
        ),
      );
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timed out waiting for the browser."));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    sendTo(ext, { type: "call", id, tool, args });
  });
}

// ---------- MCP side (Continue etc.) ----------
const server = new McpServer({ name: "ollama-browser-agent", version: "0.1.0" });

function register(name: ToolName, shape: z.ZodRawShape): void {
  server.registerTool(name, { description: TOOL_DESCRIPTIONS[name], inputSchema: shape }, async (args: unknown) => {
    try {
      const text = await callExtension(name, args);
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: "Error: " + (e instanceof Error ? e.message : String(e)) }], isError: true };
    }
  });
}

register("get_page", {});
register("click", { id: z.number().int().describe("Element number from get_page") });
register("type", { id: z.number().int(), text: z.string(), submit: z.boolean().optional() });
register("scroll", { direction: z.enum(["down", "up"]) });
register("navigate", { url: z.string() });
register("open_tab", { url: z.string() });
register("list_tabs", {});
register("switch_tab", { tab_id: z.number().int() });

await server.connect(new StdioServerTransport());
log("MCP server ready on stdio");
