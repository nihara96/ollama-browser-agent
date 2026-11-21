// Functions injected into web pages via chrome.scripting.executeScript.
// Shared by the side panel (sidepanel.js) and the MCP bridge (bridge.js).
function pageSnapshot() {
  document.querySelectorAll("[data-agent-id]").forEach((e) => e.removeAttribute("data-agent-id"));
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],[contenteditable=""],[contenteditable=true]';
  const out = [];
  let n = 0;
  const vh = window.innerHeight;
  const cands = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && el.type !== "hidden";
  });
  cands.sort((a, b) => {
    const ia = a.getBoundingClientRect().top < vh ? 0 : 1, ib = b.getBoundingClientRect().top < vh ? 0 : 1;
    return ia - ib;
  });
  for (const el of cands.slice(0, 80)) {
    n++;
    el.setAttribute("data-agent-id", String(n));
    const tag = el.tagName.toLowerCase();
    let label = el.getAttribute("aria-label") || el.innerText || el.placeholder || el.value || el.title || el.alt || el.name || "";
    label = label.replace(/\s+/g, " ").trim().slice(0, 70);
    let desc = tag === "input" ? `input(${el.type})` : tag === "a" ? "link" : tag;
    if (tag === "input" && el.value && el.type !== "password") desc += ` value="${el.value.slice(0, 40)}"`;
    if (tag === "a") desc += ` -> ${(el.getAttribute("href") || "").slice(0, 80)}`;
    out.push(`[${n}] ${desc} "${label}"`);
  }
  const text = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
  return { url: location.href, title: document.title, text, elements: out, scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight };
}

function pageClick(id) {
  const el = document.querySelector(`[data-agent-id="${id}"]`);
  if (!el) return { ok: false, error: "No element with that id. Call get_page again." };
  const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
  el.scrollIntoView({ block: "center" });
  el.click();
  return { ok: true, clicked: label };
}

function pageType(id, text, submit) {
  const el = document.querySelector(`[data-agent-id="${id}"]`);
  if (!el) return { ok: false, error: "No element with that id. Call get_page again." };
  if (el.type === "password") return { ok: false, error: "Refusing to type into a password field." };
  el.scrollIntoView({ block: "center" });
  el.focus();
  if (el.isContentEditable) { el.textContent = text; }
  else {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, text); else el.value = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (submit) {
    for (const t of ["keydown", "keypress", "keyup"])
      el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
  }
  return { ok: true };
}

function pageScroll(dir) {
  window.scrollBy(0, (dir === "up" ? -1 : 1) * Math.round(window.innerHeight * 0.8));
  return { ok: true, scrollY: Math.round(scrollY) };
}

function elementLabel(id) {
  const el = document.querySelector(`[data-agent-id="${id}"]`);
  return el ? (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

