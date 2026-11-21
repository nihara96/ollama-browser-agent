import { DEFAULT_BRIDGE_PORT, parseToolCall, type BridgeState } from "../../shared/protocol";
import { BrowserExecutor } from "./executor";
import { OLLAMA_URL, chat, listModels, type OllamaMessage } from "./ollama";
import {
  getBridgeSettings,
  getBridgeState,
  getPanelSettings,
  saveBridgeSettings,
  savePanelSettings,
} from "./settings";

const MAX_STEPS = 15;
const MAX_TOOL_CHARS = 9000;
const MAX_HISTORY_CHARS = 60000;

const SYSTEM_PROMPT = `You are a browser agent controlling the user's Chrome. You can see and act on web pages only through tools.
Workflow: call get_page to see the current page. It returns text plus a numbered list of interactive elements like [12] button "Search". Use those numbers with click and type. After any action that changes the page, call get_page again.
Be efficient: use as few steps as possible. When you have the answer or finished the task, reply in plain text without calling a tool.
Never invent page content. If something is not on the page, say so. Do not enter passwords or payment details.`;

// ---------- DOM helpers ----------
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  model: $<HTMLSelectElement>("model"),
  ctx: $<HTMLSelectElement>("ctx"),
  refresh: $<HTMLButtonElement>("refresh"),
  confirmAll: $<HTMLInputElement>("confirmAll"),
  status: $("status"),
  log: $("log"),
  empty: $("empty"),
  input: $<HTMLTextAreaElement>("input"),
  send: $<HTMLButtonElement>("send"),
  stop: $<HTMLButtonElement>("stop"),
  clear: $<HTMLButtonElement>("clear"),
  ollamaPill: $<HTMLButtonElement>("ollamaPill"),
  bridgePill: $<HTMLButtonElement>("bridgePill"),
  settings: $<HTMLDetailsElement>("settings"),
};

const bridgeEls = {
  toggle: $<HTMLButtonElement>("bridgeToggle"),
  port: $<HTMLInputElement>("bridgePort"),
  state: $("bridgeState"),
};

type PillClass = "ok" | "warn" | "err" | "off";

function setPill(el: HTMLElement, cls: PillClass, text: string, title?: string): void {
  el.className = "pill " + cls;
  const label = el.querySelector(".pt");
  if (label) label.textContent = text;
  if (title) el.title = title;
}

function setStatus(text: string, isError = false): void {
  els.status.textContent = text;
  els.status.className = "status" + (isError ? " err" : "");
}

function add(cls: string, text: string): HTMLDivElement {
  els.empty.hidden = true;
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  els.log.appendChild(d);
  els.log.scrollTop = els.log.scrollHeight;
  return d;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- State ----------
let messages: OllamaMessage[] = [];
let running = false;
let aborter: AbortController | null = null;

function setRunning(r: boolean): void {
  running = r;
  els.send.disabled = r;
  els.stop.disabled = !r;
}

function askConfirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = add("confirm", "Allow this action?\n" + text);
    const row = document.createElement("div");
    row.className = "row";
    const yes = document.createElement("button");
    yes.textContent = "Allow";
    const no = document.createElement("button");
    no.textContent = "Deny";
    const done = (allowed: boolean) => {
      row.remove();
      d.append(allowed ? "\n-> allowed" : "\n-> denied");
      resolve(allowed);
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    row.append(yes, no);
    d.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  });
}

// Risky actions always ask; "Confirm every action" asks for everything.
const executor = new BrowserExecutor((description, risky) =>
  els.confirmAll.checked || risky ? askConfirm(description) : Promise.resolve(true),
);

// ---------- Models ----------
async function loadModels(): Promise<void> {
  try {
    const models = await listModels();
    const saved = await getPanelSettings();
    els.model.innerHTML = "";
    for (const m of models) {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`;
      els.model.appendChild(o);
    }
    if (saved.model && [...els.model.options].some((o) => o.value === saved.model)) els.model.value = saved.model;
    els.ctx.value = saved.ctx;
    els.confirmAll.checked = saved.confirmAll;
    const n = models.length;
    setPill(
      els.ollamaPill,
      n ? "ok" : "warn",
      n ? `Ollama · ${n} model${n === 1 ? "" : "s"}` : "Ollama · no models",
      "Ollama server status (click to refresh)",
    );
    setStatus(n ? "" : "Ollama has no models installed.", !n);
  } catch {
    setPill(els.ollamaPill, "err", "Ollama offline", `Cannot reach ${OLLAMA_URL} (click to retry)`);
    setStatus(`Cannot reach Ollama at ${OLLAMA_URL} - is it running?`, true);
  }
}

function persistPanel(): void {
  void savePanelSettings({ model: els.model.value, ctx: els.ctx.value, confirmAll: els.confirmAll.checked });
}
els.model.onchange = els.ctx.onchange = els.confirmAll.onchange = persistPanel;
els.refresh.onclick = () => void loadModels();
els.ollamaPill.onclick = () => void loadModels();

// ---------- Agent loop ----------
function trimHistory(): void {
  let total = messages.reduce((n, m) => n + m.content.length, 0);
  for (let i = 1; i < messages.length - 2 && total > MAX_HISTORY_CHARS; i++) {
    const m = messages[i];
    if (m && m.role === "tool" && m.content.length > 200) {
      total -= m.content.length - 40;
      m.content = "[older tool output removed]";
    }
  }
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function agent(userText: string): Promise<void> {
  if (!els.model.value) {
    setStatus("Pick a model first.", true);
    return;
  }
  if (!messages.length) messages.push({ role: "system", content: SYSTEM_PROMPT });
  messages.push({ role: "user", content: userText });
  add("user", userText);
  setRunning(true);
  const controller = new AbortController();
  aborter = controller;
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      setStatus(`Thinking... (step ${step}/${MAX_STEPS})`);
      trimHistory();
      const msg = await chat({
        model: els.model.value,
        messages,
        numCtx: Number(els.ctx.value),
        signal: controller.signal,
      });
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
      if (msg.content && msg.content.trim()) add("assistant", msg.content.trim());
      if (!msg.tool_calls || !msg.tool_calls.length) {
        setStatus("Done.");
        return;
      }
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        const args = parseArguments(call.function.arguments);
        add("tool", `> ${name}(${JSON.stringify(args)})`);
        let result: string;
        try {
          result = await executor.exec(parseToolCall(name, args));
        } catch (e) {
          result = "Error: " + errorMessage(e);
        }
        if (result.length > MAX_TOOL_CHARS) result = result.slice(0, MAX_TOOL_CHARS) + "\n...[truncated]";
        messages.push({ role: "tool", tool_name: name, content: result });
      }
    }
    setStatus(`Stopped after ${MAX_STEPS} steps.`, true);
    add("err", `Reached the ${MAX_STEPS}-step limit. Send another message to continue.`);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      setStatus("Stopped.");
      add("err", "Stopped by user.");
    } else {
      setStatus(errorMessage(e), true);
      add("err", errorMessage(e));
    }
  } finally {
    setRunning(false);
    aborter = null;
  }
}

els.send.onclick = () => {
  const text = els.input.value.trim();
  if (!text || running) return;
  els.input.value = "";
  executor.resetTarget(); // re-target the tab the user is looking at
  void agent(text);
};
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.send.click();
  }
});
els.stop.onclick = () => aborter?.abort();
els.clear.onclick = () => {
  if (running) return;
  messages = [];
  els.log.querySelectorAll(".msg").forEach((n) => n.remove());
  els.empty.hidden = false;
  setStatus("");
};

// ---------- MCP bridge settings ----------
const BRIDGE_PILLS: Record<BridgeState, [PillClass, string, string]> = {
  connected: ["ok", "MCP connected", "An MCP client (e.g. Continue) is connected and can use this browser."],
  connecting: ["warn", "MCP connecting", "Connecting to the bridge server..."],
  "waiting for server": ["warn", "MCP waiting", "Connected to the extension side; waiting for the MCP server to start (it starts from Continue)."],
  off: ["off", "MCP off", "MCP bridge is off. Click to open settings and press Connect."],
};

function showBridgeState(state: BridgeState | undefined): void {
  const s: BridgeState = state ?? "off";
  bridgeEls.state.textContent = s;
  const [cls, text, title] = BRIDGE_PILLS[s] ?? ["warn", "MCP " + s, s];
  setPill(els.bridgePill, cls, text, title);
}

async function loadBridge(): Promise<void> {
  const c = await getBridgeSettings();
  showBridgeToggle(c.bridgeEnabled);
  bridgeEls.port.value = String(c.bridgePort);
  showBridgeState(await getBridgeState());
}

function showBridgeToggle(enabled: boolean): void {
  bridgeEls.toggle.textContent = enabled ? "Disconnect" : "Connect";
  bridgeEls.toggle.classList.toggle("primary", !enabled);
}

bridgeEls.toggle.onclick = async () => {
  const enabled = !(await getBridgeSettings()).bridgeEnabled;
  await saveBridgeSettings({ bridgeEnabled: enabled, bridgePort: Number(bridgeEls.port.value) || DEFAULT_BRIDGE_PORT });
};
bridgeEls.port.onchange = () => void saveBridgeSettings({ bridgePort: Number(bridgeEls.port.value) || DEFAULT_BRIDGE_PORT });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.bridgeEnabled) showBridgeToggle(Boolean(changes.bridgeEnabled.newValue));
  if (area !== "session") return;
  const state = changes.bridgeState;
  if (state) showBridgeState(state.newValue as BridgeState | undefined);
  const activity = changes.bridgeActivity?.newValue as { tool: string } | undefined;
  if (activity) {
    els.bridgePill.title = "Last MCP call: " + activity.tool;
    els.bridgePill.classList.remove("pulse");
    void els.bridgePill.offsetWidth; // restart the animation
    els.bridgePill.classList.add("pulse");
  }
});

// ---------- UI niceties ----------
els.bridgePill.onclick = () => {
  els.settings.open = true;
  bridgeEls.toggle.scrollIntoView({ block: "nearest" });
};

function autoGrow(): void {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + "px";
}
els.input.addEventListener("input", autoGrow);
els.send.addEventListener("click", () => setTimeout(autoGrow, 0));

document.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
  chip.onclick = () => {
    if (running) return;
    els.input.value = chip.dataset.prompt ?? "";
    els.send.click();
    autoGrow();
  };
});

void loadBridge();
void loadModels();
