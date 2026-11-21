// Functions injected into web pages via chrome.scripting.executeScript.
//
// IMPORTANT: each function is serialized with toString() and runs in the page, so it must be fully
// self-contained: no imports, no references to module-level variables or helpers. Type-only imports are fine.

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: string[];
  scrollY: number;
  height: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  clicked?: string;
  scrollY?: number;
}

export function pageSnapshot(): PageSnapshot {
  document.querySelectorAll("[data-agent-id]").forEach((e) => e.removeAttribute("data-agent-id"));
  const sel =
    'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],[contenteditable=""],[contenteditable=true]';
  const out: string[] = [];
  let n = 0;
  const vh = window.innerHeight;
  const cands = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      (el as HTMLInputElement).type !== "hidden"
    );
  });
  cands.sort((a, b) => {
    const ia = a.getBoundingClientRect().top < vh ? 0 : 1;
    const ib = b.getBoundingClientRect().top < vh ? 0 : 1;
    return ia - ib;
  });
  for (const el of cands.slice(0, 80)) {
    n++;
    el.setAttribute("data-agent-id", String(n));
    const f = el as HTMLInputElement & HTMLImageElement;
    const tag = el.tagName.toLowerCase();
    let label = el.getAttribute("aria-label") || el.innerText || f.placeholder || f.value || el.title || f.alt || f.name || "";
    label = label.replace(/\s+/g, " ").trim().slice(0, 70);
    let desc = tag === "input" ? `input(${f.type})` : tag === "a" ? "link" : tag;
    if (tag === "input" && f.value && f.type !== "password") desc += ` value="${f.value.slice(0, 40)}"`;
    if (tag === "a") desc += ` -> ${(el.getAttribute("href") || "").slice(0, 80)}`;
    out.push(`[${n}] ${desc} "${label}"`);
  }
  const text = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
  return {
    url: location.href,
    title: document.title,
    text,
    elements: out,
    scrollY: Math.round(scrollY),
    height: document.documentElement.scrollHeight,
  };
}

export function pageClick(id: number): ActionResult {
  const el = document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);
  if (!el) return { ok: false, error: "No element with that id. Call get_page again." };
  const label = (el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
  el.scrollIntoView({ block: "center" });
  el.click();
  return { ok: true, clicked: label };
}

export function pageType(id: number, text: string, submit: boolean): ActionResult {
  const el = document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);
  if (!el) return { ok: false, error: "No element with that id. Call get_page again." };
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if ((field as HTMLInputElement).type === "password") return { ok: false, error: "Refusing to type into a password field." };
  el.scrollIntoView({ block: "center" });
  el.focus();
  if (el.isContentEditable) {
    el.textContent = text;
  } else {
    // Use the native setter so frameworks (React, Vue...) notice the change.
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(field, text);
    else field.value = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (submit) {
    for (const t of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
    const form = field.form;
    if (form) {
      if (form.requestSubmit) form.requestSubmit();
      else form.submit();
    }
  }
  return { ok: true };
}

export function pageScroll(dir: "up" | "down"): ActionResult {
  window.scrollBy(0, (dir === "up" ? -1 : 1) * Math.round(window.innerHeight * 0.8));
  return { ok: true, scrollY: Math.round(scrollY) };
}

export function elementLabel(id: number): string {
  const el = document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);
  return el
    ? (el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80)
    : "";
}
