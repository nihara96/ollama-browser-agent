// MCP bridge client. Runs in the service worker.
// Connects to the local bridge server (mcp-bridge/) over WebSocket and executes the tool calls it
// forwards from an MCP client such as the Continue VS Code extension.
// Disabled by default: the user turns it on with the Connect button in the side panel.

import { parseToolCall, type ExtensionMessage, type ServerMessage } from "../../shared/protocol";
import { BrowserExecutor } from "./executor";
import { getBridgeSettings, recordBridgeActivity, setBridgeState } from "./settings";

// No confirmation callback: the MCP client's own tool policy is responsible for approval.
const executor = new BrowserExecutor();

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function send(ws: WebSocket, msg: ExtensionMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket closed */
  }
}

function closeBridge(): void {
  clearInterval(pingTimer);
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  socket = null;
}

async function handleCall(ws: WebSocket, id: number, tool: string, args: unknown): Promise<void> {
  recordBridgeActivity(tool);
  try {
    const result = await executor.exec(parseToolCall(tool, args));
    send(ws, { type: "result", id, ok: true, result });
  } catch (e) {
    send(ws, { type: "result", id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function connectBridge(): Promise<void> {
  const cfg = await getBridgeSettings();
  if (!cfg.bridgeEnabled) {
    closeBridge();
    setBridgeState("off");
    return;
  }
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${cfg.bridgePort}`);
  } catch {
    setBridgeState("waiting for server");
    return;
  }
  socket = ws;
  setBridgeState("connecting");

  ws.onopen = () => send(ws, { type: "hello" });

  ws.onmessage = (ev) => {
    let m: ServerMessage;
    try {
      m = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    switch (m.type) {
      case "welcome":
        setBridgeState("connected");
        clearInterval(pingTimer);
        // Regular traffic keeps the service worker alive while connected.
        pingTimer = setInterval(() => send(ws, { type: "ping" }), 20000);
        break;
      case "call":
        void handleCall(ws, m.id, m.tool, m.args);
        break;
    }
  };

  ws.onclose = () => {
    if (socket === ws) {
      socket = null;
      clearInterval(pingTimer);
    }
    chrome.storage.session.get({ bridgeState: "" }).then((s) => {
      if (s.bridgeState === "connected" || s.bridgeState === "connecting") setBridgeState("waiting for server");
    });
  };
  ws.onerror = () => {};
}

/** Wire up reconnect timers and settings listeners. Call once from the service worker. */
export function startBridge(): void {
  // Earlier versions stored a shared token; it is no longer used.
  void chrome.storage.local.remove("bridgeToken");
  chrome.alarms.create("bridge-reconnect", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "bridge-reconnect") void connectBridge();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ("bridgeEnabled" in changes || "bridgePort" in changes)) {
      closeBridge();
      void connectBridge();
    }
  });
  chrome.runtime.onStartup.addListener(() => void connectBridge());
  chrome.runtime.onInstalled.addListener(() => void connectBridge());
  void connectBridge();
}
