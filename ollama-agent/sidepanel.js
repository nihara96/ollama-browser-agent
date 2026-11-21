const OLLAMA = "http://localhost:11434";
const MAX_STEPS = 15;
const MAX_TOOL_CHARS = 9000;
const MAX_HISTORY_CHARS = 60000;

const $ = (id) => document.getElementById(id);
const els = {
  model: $("model"), ctx: $("ctx"), refresh: $("refresh"), confirmAll: $("confirmAll"),
  status: $("status"), log: $("log"), input: $("input"),
  send: $("send"), stop: $("stop"), clear: $("clear"),
};

let messages = [];
let running = false;
let aborter = null;
let targetTabId = null;

const SYSTEM_PROMPT = `You are a browser agent controlling the user's Chrome. You can see and act on web pages only through tools.
Workflow: call get_page to see the current page. It returns text plus a numbered list of interactive elements like [12] button "Search". Use those numbers with click and type. After any action that changes the page, call get_page again.
Be efficient: use as few steps as possible. When you have the answer or finished the task, reply in plain text without calling a tool.
Never invent page content. If something is not on the page, say so. Do not enter passwords or payment details.`;

const TOOLS = [
  fn("get_page", "Read the current tab: URL, title, visible text, and numbered interactive elements.", {}),
  fn("click", "Click an interactive element by its number from get_page.", { id: { type: "integer" } }, ["id"]),
  fn("type", "Type text into an input/textarea by its number. Set submit=true to press Enter afterwards.",
    { id: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" } }, ["id", "text"]),
  fn("scroll", "Scroll the page.", { direction: { type: "string", enum: ["down", "up"] } }, ["direction"]),
  fn("navigate", "Navigate the current tab to a URL.", { url: { type: "string" } }, ["url"]),
  fn("open_tab", "Open a URL in a new tab and switch to it.", { url: { type: "string" } }, ["url"]),
  fn("list_tabs", "List open tabs with their ids.", {}),
  fn("switch_tab", "Switch the agent to another tab by id.", { tab_id: { type: "integer" } }, ["tab_id"]),
];

function fn(name, description, properties, required = []) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

// ---------- UI helpers ----------
function setPill(el, cls, text, title) {
  el.className = "pill " + cls;
  el.querySelector(".pt").textContent = text;
  if (title) el.title = title;
}

function add(cls, text) {
  const empty = $("empty");
  if (empty) empty.hidden = true;
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  els.log.appendChild(d);
  els.log.scrollTop = els.log.scrollHeight;
  return d;
}
function setStatus(t, err = false) { els.status.textContent = t; els.status.className = "status" + (err ? " err" : ""); }
function setRunning(r) { running = r; els.send.disabled = r; els.stop.disabled = !r; }

function askConfirm(text) {
  return new Promise((resolve) => {
    const d = add("confirm", "Allow this action?\n" + text);
    const row = document.createElement("div");
    row.className = "row";
    const yes = document.createElement("button"); yes.textContent = "Allow";
    const no = document.createElement("button"); no.textContent = "Deny";
    const done = (v) => { row.remove(); d.append(v ? "\n-> allowed" : "\n-> denied"); resolve(v); };
    yes.onclick = () => done(true); no.onclick = () => done(false);
    row.append(yes, no); d.appendChild(row);
    els.log.scrollTop = els.log.scrollHeight;
  });
}

// ---------- Models ----------
async function loadModels() {
  try {
    const r = await fetch(OLLAMA + "/api/tags");
    const j = await r.json();
    const saved = (await chrome.storage.local.get(["model", "ctx", "confirmAll"]));
    els.model.innerHTML = "";
    for (const m of j.models || []) {
      const o = document.createElement("option");
      o.value = m.name; o.textContent = `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`;
      els.model.appendChild(o);
    }
    if (saved.model && [...els.model.options].some((o) => o.value === saved.model)) els.model.value = saved.model;
    if (saved.ctx) els.ctx.value = saved.ctx;
    els.confirmAll.checked = !!saved.confirmAll;
    const n = (j.models || []).length;
    setPill($("ollamaPill"), n ? "ok" : "warn", n ? `Ollama · ${n} model${n === 1 ? "" : "s"}` : "Ollama · no models", "Ollama server status (click to refresh)");
    setStatus(n ? "" : "Ollama has no models installed.", !n);
  } catch (e) {
    setPill($("ollamaPill"), "err", "Ollama offline", "Cannot reach " + OLLAMA + " (click to retry)");
    setStatus("Cannot reach Ollama at " + OLLAMA + " - is it running?", true);
  }
}
const persist = () => chrome.storage.local.set({ model: els.model.value, ctx: els.ctx.value, confirmAll: els.confirmAll.checked });
els.model.onchange = els.ctx.onchange = els.confirmAll.onchange = persist;
els.refresh.onclick = loadModels;

// ---------- Tab helpers ----------
async function activeTabId() {
  if (targetTabId != null) {
    try { await chrome.tabs.get(targetTabId); return targetTabId; } catch { targetTabId = null; }
  }
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) throw new Error("No active tab");
  targetTabId = t.id;
  return t.id;
}

function waitForLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeout);
    function listener(id, info) { if (id === tabId && info.status === "complete") done(); }
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); setTimeout(resolve, 400); }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function run(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res && res.result;
}

// ---------- Tool execution ----------
const RISKY = /\b(submit|buy|purchase|pay|checkout|place order|order now|delete|remove|send|confirm|subscribe|sign out|log ?out|publish|post|transfer|donate)\b/i;

async function execTool(name, args) {
  const tabId = await activeTabId();
  switch (name) {
    case "get_page": {
      const s = await run(tabId, pageSnapshot);
      if (!s) return "Could not read this page (restricted page such as chrome:// or the Web Store).";
      return `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scrollY}/${s.height}\n\nTEXT:\n${s.text}\n\nELEMENTS:\n${s.elements.join("\n")}`;
    }
    case "click": {
      const label = await run(tabId, elementLabel, [args.id]);
      if (els.confirmAll.checked || RISKY.test(label || "")) {
        if (!(await askConfirm(`Click [${args.id}] "${label}"`))) return "User denied this action.";
      }
      const r = await run(tabId, pageClick, [args.id]);
      await new Promise((res) => setTimeout(res, 700));
      return JSON.stringify(r);
    }
    case "type": {
      if (els.confirmAll.checked || args.submit) {
        if (!(await askConfirm(`Type "${args.text}" into [${args.id}]${args.submit ? " and press Enter" : ""}`))) return "User denied this action.";
      }
      const r = await run(tabId, pageType, [args.id, String(args.text), !!args.submit]);
      await new Promise((res) => setTimeout(res, 700));
      return JSON.stringify(r);
    }
    case "scroll":
      return JSON.stringify(await run(tabId, pageScroll, [args.direction]));
    case "navigate": {
      const url = normUrl(args.url);
      if (els.confirmAll.checked && !(await askConfirm("Navigate to " + url))) return "User denied this action.";
      await chrome.tabs.update(tabId, { url });
      await waitForLoad(tabId);
      return "Navigated to " + url;
    }
    case "open_tab": {
      const url = normUrl(args.url);
      if (els.confirmAll.checked && !(await askConfirm("Open new tab: " + url))) return "User denied this action.";
      const t = await chrome.tabs.create({ url });
      targetTabId = t.id;
      await waitForLoad(t.id);
      return `Opened tab ${t.id}: ${url}`;
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => `${t.id}${t.id === targetTabId ? " (current)" : ""}: ${t.title} - ${t.url}`).join("\n");
    }
    case "switch_tab": {
      await chrome.tabs.get(args.tab_id);
      targetTabId = args.tab_id;
      await chrome.tabs.update(args.tab_id, { active: true });
      return "Switched to tab " + args.tab_id;
    }
    default:
      return "Unknown tool: " + name;
  }
}

function normUrl(u) {
  u = String(u || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  if (!/^https?:/i.test(u)) throw new Error("Only http(s) URLs are allowed.");
  return u;
}

// ---------- Agent loop ----------
function trimHistory() {
  let total = messages.reduce((n, m) => n + (m.content || "").length, 0);
  for (let i = 1; i < messages.length - 2 && total > MAX_HISTORY_CHARS; i++) {
    const m = messages[i];
    if (m.role === "tool" && m.content.length > 200) {
      total -= m.content.length - 40;
      m.content = "[older tool output removed]";
    }
  }
}

async function chat(signal) {
  trimHistory();
  const r = await fetch(OLLAMA + "/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: els.model.value,
      messages,
      tools: TOOLS,
      stream: false,
      options: { num_ctx: Number(els.ctx.value), temperature: 0.3 },
    }),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).message;
}

async function agent(userText) {
  if (!els.model.value) { setStatus("Pick a model first.", true); return; }
  if (!messages.length) messages.push({ role: "system", content: SYSTEM_PROMPT });
  messages.push({ role: "user", content: userText });
  add("user", userText);
  setRunning(true);
  aborter = new AbortController();
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      setStatus(`Thinking... (step ${step}/${MAX_STEPS})`);
      const msg = await chat(aborter.signal);
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
      if (msg.content && msg.content.trim()) add("assistant", msg.content.trim());
      if (!msg.tool_calls || !msg.tool_calls.length) { setStatus("Done."); return; }
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args = call.function.arguments || {};
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        add("tool", `> ${name}(${JSON.stringify(args)})`);
        let result;
        try { result = await execTool(name, args); }
        catch (e) { result = "Error: " + e.message; }
        if (result.length > MAX_TOOL_CHARS) result = result.slice(0, MAX_TOOL_CHARS) + "\n...[truncated]";
        messages.push({ role: "tool", tool_name: name, content: result });
      }
    }
    setStatus(`Stopped after ${MAX_STEPS} steps.`, true);
    add("err", `Reached the ${MAX_STEPS}-step limit. Send another message to continue.`);
  } catch (e) {
    if (e.name === "AbortError") { setStatus("Stopped."); add("err", "Stopped by user."); }
    else { setStatus(e.message, true); add("err", e.message); }
  } finally {
    setRunning(false);
    aborter = null;
  }
}

els.send.onclick = () => {
  const t = els.input.value.trim();
  if (!t || running) return;
  els.input.value = "";
  targetTabId = null; // re-target the tab the user is looking at
  agent(t);
};
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); els.send.click(); }
});
els.stop.onclick = () => aborter && aborter.abort();
els.clear.onclick = () => {
  if (running) return;
  messages = [];
  els.log.querySelectorAll(".msg").forEach((n) => n.remove());
  $("empty").hidden = false;
  setStatus("");
};

// ---------- MCP bridge settings ----------
const bridgeEls = { on: $("bridgeOn"), token: $("bridgeToken"), port: $("bridgePort"), state: $("bridgeState") };
async function loadBridge() {
  const c = await chrome.storage.local.get({ bridgeEnabled: false, bridgeToken: "", bridgePort: 8765 });
  bridgeEls.on.checked = c.bridgeEnabled;
  bridgeEls.token.value = c.bridgeToken;
  bridgeEls.port.value = c.bridgePort;
  const s = await chrome.storage.session.get({ bridgeState: "off" });
  showBridgeState(s.bridgeState);
}
function showBridgeState(state) {
  state = state || "off";
  bridgeEls.state.textContent = state;
  const map = {
    "connected": ["ok", "MCP connected", "An MCP client (e.g. Continue) is connected and can use this browser."],
    "connecting": ["warn", "MCP connecting", "Connecting to the bridge server..."],
    "waiting for server": ["warn", "MCP waiting", "Bridge enabled, waiting for the MCP server to start (it starts from Continue)."],
    "token rejected by server": ["err", "MCP token rejected", "The token does not match BRIDGE_TOKEN in the MCP config."],
    "off": ["off", "MCP off", "MCP bridge is off. Click to open settings."],
  };
  const [cls, text, title] = map[state] || ["warn", "MCP " + state, state];
  setPill($("bridgePill"), cls, text, title);
}
function saveBridge() {
  chrome.storage.local.set({
    bridgeEnabled: bridgeEls.on.checked,
    bridgeToken: bridgeEls.token.value.trim(),
    bridgePort: Number(bridgeEls.port.value) || 8765,
  });
}
bridgeEls.on.onchange = bridgeEls.token.onchange = bridgeEls.port.onchange = saveBridge;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "session") return;
  if (ch.bridgeState) showBridgeState(ch.bridgeState.newValue);
  if (ch.bridgeActivity && ch.bridgeActivity.newValue) {
    const pill = $("bridgePill");
    pill.title = "Last MCP call: " + ch.bridgeActivity.newValue.tool;
    pill.classList.remove("pulse");
    void pill.offsetWidth; // restart the animation
    pill.classList.add("pulse");
  }
});
loadBridge();

// ---------- UI niceties ----------
$("bridgePill").onclick = () => { $("settings").open = true; bridgeEls.token.scrollIntoView({ block: "nearest" }); };
$("ollamaPill").onclick = loadModels;
document.querySelectorAll(".chip").forEach((c) => {
  c.onclick = () => { if (running) return; els.input.value = c.dataset.prompt; els.send.click(); autoGrow(); };
});
function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + "px";
}
els.input.addEventListener("input", autoGrow);
els.send.addEventListener("click", () => setTimeout(autoGrow, 0));

loadModels();
