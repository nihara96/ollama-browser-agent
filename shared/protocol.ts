// Types and helpers shared by the Chrome extension and the MCP bridge server.
// Keep this file free of environment-specific APIs (no DOM, no Node).

export const DEFAULT_BRIDGE_PORT = 8765;

export const TOOL_NAMES = [
  "get_page",
  "click",
  "type",
  "scroll",
  "navigate",
  "open_tab",
  "list_tabs",
  "switch_tab",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolArgsMap {
  get_page: Record<string, never>;
  click: { id: number };
  type: { id: number; text: string; submit: boolean };
  scroll: { direction: "up" | "down" };
  navigate: { url: string };
  open_tab: { url: string };
  list_tabs: Record<string, never>;
  switch_tab: { tab_id: number };
}

/** A validated tool call: `name` narrows `args`. */
export type ToolCall = { [K in ToolName]: { name: K; args: ToolArgsMap[K] } }[ToolName];

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_page:
    'Read the current browser tab: URL, title, visible text, and a numbered list of interactive elements like [12] button "Search". Call this before click/type and again after the page changes.',
  click: "Click an interactive element by its number from the latest get_page.",
  type: "Type text into an input or textarea by its number from get_page. Set submit=true to press Enter afterwards.",
  scroll: "Scroll the current page up or down by about one screen.",
  navigate: "Navigate the current tab to an http(s) URL.",
  open_tab: "Open an http(s) URL in a new tab and switch to it.",
  list_tabs: "List all open tabs with their ids.",
  switch_tab: "Switch to another tab by id (from list_tabs).",
};

function toInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error("Expected an integer argument.");
  return n;
}

/** Validate and normalize a tool call coming from a model or an MCP client. Throws on bad input. */
export function parseToolCall(name: string, raw: unknown): ToolCall {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (name) {
    case "get_page":
      return { name: "get_page", args: {} };
    case "list_tabs":
      return { name: "list_tabs", args: {} };
    case "click":
      return { name: "click", args: { id: toInt(a.id) } };
    case "type":
      return {
        name: "type",
        args: { id: toInt(a.id), text: String(a.text ?? ""), submit: a.submit === true || a.submit === "true" },
      };
    case "scroll":
      return { name: "scroll", args: { direction: a.direction === "up" ? "up" : "down" } };
    case "navigate":
      return { name: "navigate", args: { url: String(a.url ?? "") } };
    case "open_tab":
      return { name: "open_tab", args: { url: String(a.url ?? "") } };
    case "switch_tab":
      return { name: "switch_tab", args: { tab_id: toInt(a.tab_id) } };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------- WebSocket protocol: bridge server <-> extension ----------

/** Messages the extension sends to the bridge server. */
export type ExtensionMessage =
  | { type: "hello" }
  | { type: "ping" }
  | { type: "result"; id: number; ok: true; result: string }
  | { type: "result"; id: number; ok: false; error: string };

/** Messages the bridge server sends to the extension. */
export type ServerMessage =
  | { type: "welcome" }
  | { type: "call"; id: number; tool: string; args: unknown };

/** Connection state shown in the side panel. */
export type BridgeState =
  | "off"
  | "connecting"
  | "connected"
  | "waiting for server";
