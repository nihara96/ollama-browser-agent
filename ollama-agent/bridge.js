// MCP bridge client. Runs in the service worker (loaded by background.js after tools.js).
// Connects to the local bridge server (mcp-bridge/) over WebSocket and executes the tool
// calls it forwards from an MCP client such as the Continue VS Code extension.
// Disabled by default: enable it and set a token in the side panel.

let bridgeWs = null;
let bridgeTabId = null;
let pingTimer = null;

async function bridgeCfg() {
  return chrome.storage.local.get({ bridgeEnabled: false, bridgeToken: "", bridgePort: 8765 });
}

function setBridgeState(state) {
  chrome.storage.session.set({ bridgeState: state }).catch(() => {});
}

function closeBridge() {
  clearInterval(pingTimer);
  if (bridgeWs) { try { bridgeWs.close(); } catch {} }
  bridgeWs = null;
}

async function connectBridge() {
  const cfg = await bridgeCfg();
  if (!cfg.bridgeEnabled || !cfg.bridgeToken) { closeBridge(); setBridgeState("off"); return; }
  if (bridgeWs && (bridgeWs.readyState === WebSocket.CONNECTING || bridgeWs.readyState === WebSocket.OPEN)) return;

  let ws;
  try { ws = new WebSocket(`ws://127.0.0.1:${cfg.bridgePort}`); }
  catch { setBridgeState("waiting for server"); return; }
  bridgeWs = ws;
  setBridgeState("connecting");

  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: cfg.bridgeToken }));
  ws.onmessage = async (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "welcome") {
      setBridgeState("connected");
      clearInterval(pingTimer);
      // Regular traffic keeps the service worker alive while connected.
      pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ type: "ping" })); } catch {} }, 20000);
    } else if (m.type === "denied") {
      setBridgeState("token rejected by server");
    } else if (m.type === "call") {
      chrome.storage.session.set({ bridgeActivity: { tool: m.tool, t: Date.now() } }).catch(() => {});
      let reply;
      try { reply = { type: "result", id: m.id, ok: true, result: await bridgeTool(m.tool, m.args || {}) }; }
      catch (e) { reply = { type: "result", id: m.id, ok: false, error: String((e && e.message) || e) }; }
      try { ws.send(JSON.stringify(reply)); } catch {}
    }
  };
  ws.onclose = () => {
    if (bridgeWs === ws) { bridgeWs = null; clearInterval(pingTimer); }
    chrome.storage.session.get({ bridgeState: "" }).then((s) => {
      if (s.bridgeState === "connected" || s.bridgeState === "connecting") setBridgeState("waiting for server");
    });
  };
  ws.onerror = () => {};
}

// ---------- tool execution (no UI; the MCP client's own tool policy handles approval) ----------
async function bridgeTab() {
  if (bridgeTabId != null) {
    try { await chrome.tabs.get(bridgeTabId); return bridgeTabId; } catch { bridgeTabId = null; }
  }
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) throw new Error("No active tab");
  bridgeTabId = t.id;
  return t.id;
}

async function runInTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res && res.result;
}

function waitTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeout);
    function listener(id, info) { if (id === tabId && info.status === "complete") done(); }
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); setTimeout(resolve, 400); }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function httpUrl(u) {
  u = String(u || "").trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  if (!/^https?:/i.test(u)) throw new Error("Only http(s) URLs are allowed.");
  return u;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridgeTool(name, a) {
  const tabId = await bridgeTab();
  switch (name) {
    case "get_page": {
      const s = await runInTab(tabId, pageSnapshot);
      if (!s) return "Could not read this page (restricted page such as chrome:// or the Web Store).";
      return `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scrollY}/${s.height}\n\nTEXT:\n${s.text}\n\nELEMENTS:\n${s.elements.join("\n")}`;
    }
    case "click": {
      const r = await runInTab(tabId, pageClick, [a.id]);
      await sleep(700);
      return JSON.stringify(r);
    }
    case "type": {
      const r = await runInTab(tabId, pageType, [a.id, String(a.text), !!a.submit]);
      await sleep(700);
      return JSON.stringify(r);
    }
    case "scroll":
      return JSON.stringify(await runInTab(tabId, pageScroll, [a.direction]));
    case "navigate": {
      const url = httpUrl(a.url);
      await chrome.tabs.update(tabId, { url });
      await waitTabLoad(tabId);
      return "Navigated to " + url;
    }
    case "open_tab": {
      const url = httpUrl(a.url);
      const t = await chrome.tabs.create({ url });
      bridgeTabId = t.id;
      await waitTabLoad(t.id);
      return `Opened tab ${t.id}: ${url}`;
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => `${t.id}${t.id === bridgeTabId ? " (current)" : ""}: ${t.title} - ${t.url}`).join("\n");
    }
    case "switch_tab": {
      await chrome.tabs.get(a.tab_id);
      bridgeTabId = a.tab_id;
      await chrome.tabs.update(a.tab_id, { active: true });
      return "Switched to tab " + a.tab_id;
    }
    default:
      throw new Error("Unknown tool: " + name);
  }
}

// Keep trying to (re)connect, and react to settings changes.
chrome.alarms.create("bridge-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((al) => { if (al.name === "bridge-reconnect") connectBridge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("bridgeEnabled" in changes || "bridgeToken" in changes || "bridgePort" in changes)) {
    closeBridge();
    connectBridge();
  }
});
chrome.runtime.onStartup.addListener(connectBridge);
chrome.runtime.onInstalled.addListener(connectBridge);
connectBridge();
