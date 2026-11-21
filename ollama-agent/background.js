// Shared page functions + MCP bridge client (see bridge.js).
importScripts("tools.js", "bridge.js");

// Open the side panel when the toolbar icon is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Ollama rejects requests whose Origin is chrome-extension://... unless OLLAMA_ORIGINS is set.
// Strip the Origin header on requests to the local Ollama server so no env var is needed.
async function installRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "origin", operation: "remove" }],
        },
        condition: {
          urlFilter: "||localhost:11434/",
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 2,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "origin", operation: "remove" }],
        },
        condition: {
          urlFilter: "||127.0.0.1:11434/",
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });
}

chrome.runtime.onInstalled.addListener(installRules);
chrome.runtime.onStartup.addListener(installRules);
