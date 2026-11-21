import type { ToolCall } from "../../shared/protocol";
import { elementLabel, pageClick, pageScroll, pageSnapshot, pageType } from "./pageFunctions";

/**
 * Asked before an action runs. `risky` is true for actions that look destructive or irreversible.
 * Return false to deny. The side panel supplies one; the MCP bridge does not (the MCP client's own
 * tool policy handles approval there).
 */
export type ConfirmFn = (description: string, risky: boolean) => Promise<boolean>;

const RISKY =
  /\b(submit|buy|purchase|pay|checkout|place order|order now|delete|remove|send|confirm|subscribe|sign out|log ?out|publish|post|transfer|donate)\b/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  if (!/^https?:/i.test(u)) throw new Error("Only http(s) URLs are allowed.");
  return u;
}

function waitForLoad(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 400);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function runInTab<A extends unknown[], R>(tabId: number, func: (...args: A) => R, args: A) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

/** Executes browser tools against a "current" tab. Shared by the side panel and the MCP bridge. */
export class BrowserExecutor {
  private targetTabId: number | null = null;

  constructor(private readonly confirm?: ConfirmFn) {}

  /** Forget the current tab so the next call targets whatever tab the user is looking at. */
  resetTarget(): void {
    this.targetTabId = null;
  }

  private async currentTab(): Promise<number> {
    if (this.targetTabId !== null) {
      try {
        await chrome.tabs.get(this.targetTabId);
        return this.targetTabId;
      } catch {
        this.targetTabId = null;
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("No active tab");
    this.targetTabId = tab.id;
    return tab.id;
  }

  private async allowed(description: string, risky: boolean): Promise<boolean> {
    return this.confirm ? this.confirm(description, risky) : true;
  }

  async exec(call: ToolCall): Promise<string> {
    const tabId = await this.currentTab();
    switch (call.name) {
      case "get_page": {
        const s = await runInTab(tabId, pageSnapshot, []);
        if (!s) return "Could not read this page (restricted page such as chrome:// or the Web Store).";
        return `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scrollY}/${s.height}\n\nTEXT:\n${s.text}\n\nELEMENTS:\n${s.elements.join("\n")}`;
      }
      case "click": {
        const label = (await runInTab(tabId, elementLabel, [call.args.id])) ?? "";
        if (!(await this.allowed(`Click [${call.args.id}] "${label}"`, RISKY.test(label)))) return "User denied this action.";
        const r = await runInTab(tabId, pageClick, [call.args.id]);
        await sleep(700);
        return JSON.stringify(r);
      }
      case "type": {
        const { id, text, submit } = call.args;
        const desc = `Type "${text}" into [${id}]${submit ? " and press Enter" : ""}`;
        if (!(await this.allowed(desc, submit))) return "User denied this action.";
        const r = await runInTab(tabId, pageType, [id, text, submit]);
        await sleep(700);
        return JSON.stringify(r);
      }
      case "scroll":
        return JSON.stringify(await runInTab(tabId, pageScroll, [call.args.direction]));
      case "navigate": {
        const url = normalizeUrl(call.args.url);
        if (!(await this.allowed("Navigate to " + url, false))) return "User denied this action.";
        await chrome.tabs.update(tabId, { url });
        await waitForLoad(tabId);
        return "Navigated to " + url;
      }
      case "open_tab": {
        const url = normalizeUrl(call.args.url);
        if (!(await this.allowed("Open new tab: " + url, false))) return "User denied this action.";
        const tab = await chrome.tabs.create({ url });
        if (tab.id === undefined) throw new Error("Could not open a tab.");
        this.targetTabId = tab.id;
        await waitForLoad(tab.id);
        return `Opened tab ${tab.id}: ${url}`;
      }
      case "list_tabs": {
        const tabs = await chrome.tabs.query({});
        return tabs.map((t) => `${t.id}${t.id === this.targetTabId ? " (current)" : ""}: ${t.title} - ${t.url}`).join("\n");
      }
      case "switch_tab": {
        await chrome.tabs.get(call.args.tab_id);
        this.targetTabId = call.args.tab_id;
        await chrome.tabs.update(call.args.tab_id, { active: true });
        return "Switched to tab " + call.args.tab_id;
      }
    }
  }
}
