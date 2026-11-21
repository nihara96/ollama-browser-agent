# Ollama Browser Agent

Chrome side-panel extension that lets a local Ollama model read and operate your browser tabs.

## Install
1. Make sure Ollama is running (`ollama list` should work).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Click the extension icon to open the side panel, pick a model in the dropdown, and chat.

## Notes
- The extension removes the `Origin` header on requests to `localhost:11434`, so you should not need `OLLAMA_ORIGINS`.
  If you still get a 403, set `OLLAMA_ORIGINS=chrome-extension://*` and restart Ollama.
- Tools: get_page, click, type, scroll, navigate, open_tab, list_tabs, switch_tab.
- Risky clicks (submit, buy, delete, send...) and typing with Enter ask for confirmation. Tick "Confirm every action" for full control.
- It never types into password fields. Max 15 steps per message; use Stop to cancel.
- Does not work on `chrome://` pages or the Chrome Web Store.
- Small models struggle with long multi-step flows; keep tasks short and specific.
