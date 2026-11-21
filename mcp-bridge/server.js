#!/usr/bin/env node
// MCP server (stdio) <-> WebSocket <-> Ollama Browser Agent Chrome extension.
//
// An MCP client (Continue, etc.) launches this process and speaks MCP over stdin/stdout.
// The Chrome extension connects to ws://127.0.0.1:PORT and executes the browser tool calls.
// IMPORTANT: stdout belongs to MCP. Log to stderr only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.BRIDGE_TOKEN || "";
const PORT = Number(process.env.BRIDGE_PORT || 8765);
const CALL_TIMEOUT_MS = 45000;
// Log to stderr (stdout is MCP) and to bridge.log next to this file, because MCP clients often hide stderr.
const LOG_FILE = fileURLToPath(new URL("./bridge.log", import.meta.url));
const log = (...a) => {
  console.error("[bridge]", ...a);
  try { appendFileSync(LOG_FILE, `${new Date().toISOString()} [${process.pid}] ${a.join(" ")}\n`); } catch {}
};
process.on("uncaughtException", (e) => { log("uncaughtException:", e && e.stack || e); });
process.on("unhandledRejection", (e) => { log("unhandledRejection:", e && e.stack || e); });
log(`starting; node ${process.version}; cwd=${process.cwd()}; port=${PORT}; tokenLength=${TOKEN.length}; SystemRoot=${process.env.SystemRoot || "(missing)"}`);

if (!TOKEN || TOKEN.length < 12) {
  log("BRIDGE_TOKEN is missing or too short (min 12 chars). Set it in the MCP server env and in the extension.");
  process.exit(1);
}

// ---------- WebSocket side (extension) ----------
let ext = null; // authenticated extension socket
let nextId = 1;
const pending = new Map();

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  // Only the Chrome extension (or a non-browser client) may connect; never an ordinary web page.
  verifyClient: ({ origin }) => !origin || origin.startsWith("chrome-extension://"),
});
wss.on("listening", () => log(`listening on ws://127.0.0.1:${PORT}`));
wss.on("error", (e) => log("websocket server error:", e.message));

function tokenOk(t) {
  const a = Buffer.from(String(t || ""));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

wss.on("connection", (ws) => {
  let authed = false;
  const timer = setTimeout(() => { if (!authed) ws.close(); }, 5000);
  ws.on("message", (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!authed) {
      if (m.type === "hello" && tokenOk(m.token)) {
        authed = true;
        clearTimeout(timer);
        if (ext && ext !== ws) { try { ext.close(); } catch {} }
        ext = ws;
        ws.send(JSON.stringify({ type: "welcome" }));
        log("extension connected");
      } else {
        ws.send(JSON.stringify({ type: "denied" }));
        ws.close();
      }
      return;
    }
    if (m.type === "result" && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || "Tool failed"));
    }
    // "ping" messages need no reply.
  });
  ws.on("close", () => {
    clearTimeout(timer);
    if (ext === ws) {
      ext = null;
      log("extension disconnected");
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("Extension disconnected")); pending.delete(id); }
    }
  });
});

function callExtension(tool, args) {
  return new Promise((resolve, reject) => {
    if (!ext || ext.readyState !== 1) {
      return reject(new Error(
        "The Chrome extension is not connected. Open the Ollama Agent side panel, expand 'MCP bridge', tick the checkbox, and set the same token as BRIDGE_TOKEN."));
    }
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out waiting for the browser.")); }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ext.send(JSON.stringify({ type: "call", id, tool, args }));
  });
}

// ---------- MCP side (Continue etc.) ----------
const server = new McpServer({ name: "ollama-browser-agent", version: "0.1.0" });

function register(name, description, shape) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      const text = await callExtension(name, args);
      return { content: [{ type: "text", text: String(text) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "Error: " + e.message }], isError: true };
    }
  });
}

register("get_page",
  "Read the current browser tab: URL, title, visible text, and a numbered list of interactive elements like [12] button \"Search\". Call this before click/type and again after the page changes.",
  {});
register("click", "Click an interactive element by its number from the latest get_page.",
  { id: z.number().int().describe("Element number from get_page") });
register("type", "Type text into an input or textarea by its number from get_page. Set submit=true to press Enter afterwards.",
  { id: z.number().int(), text: z.string(), submit: z.boolean().optional() });
register("scroll", "Scroll the current page up or down by about one screen.",
  { direction: z.enum(["down", "up"]) });
register("navigate", "Navigate the current tab to an http(s) URL.", { url: z.string() });
register("open_tab", "Open an http(s) URL in a new tab and switch to it.", { url: z.string() });
register("list_tabs", "List all open tabs with their ids.", {});
register("switch_tab", "Switch to another tab by id (from list_tabs).", { tab_id: z.number().int() });

await server.connect(new StdioServerTransport());
log("MCP server ready on stdio");
