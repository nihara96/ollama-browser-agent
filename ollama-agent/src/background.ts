import { startBridge } from "./bridge";

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Ollama rejects requests whose Origin is chrome-extension://... unless OLLAMA_ORIGINS is set.
// Strip the Origin header on requests to the local Ollama server so no env var is needed.
async function installRules(): Promise<void> {
  const hosts = ["localhost:11434", "127.0.0.1:11434"];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: hosts.map((host, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          { header: "origin", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
        ],
      },
      condition: {
        urlFilter: `||${host}/`,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
      },
    })),
  });
}

chrome.runtime.onInstalled.addListener(() => void installRules());
chrome.runtime.onStartup.addListener(() => void installRules());

startBridge();
