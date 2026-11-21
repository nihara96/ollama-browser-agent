# Privacy Policy: Ollama Browser Agent

_Last updated: 21 November 2026_

Ollama Browser Agent is a Chrome extension that lets a locally running Ollama model read and operate your browser tabs at your request.

## What the extension processes
When you ask the agent to do something, it reads the content and structure of the tab you are working on (text, links, form fields, URL, title) and the list of your open tabs, and it can click, type, scroll and navigate on your behalf.

## Where the data goes
- Page and tab data is sent **only** to the Ollama server on your own machine (`localhost:11434` / `127.0.0.1:11434`).
- If you enable the optional MCP bridge, tool calls and results are exchanged only with the bridge process on your own machine (`127.0.0.1`, default port 8765), and from there with the MCP client you configured.
- The developer does not receive any data. The extension has no analytics, telemetry, accounts, advertising or remote servers.

## What is stored
Your settings (selected model, context size, confirmation preference, bridge port) are stored locally in Chrome storage. Chat history is kept in the side panel only for the current session. Nothing is uploaded.

## What the extension does not do
It does not sell or share data, does not use data for advertising or credit decisions, does not load remote code, and never types into password fields.

## Third parties
Anything you connect to the extension (an Ollama model, an MCP client such as Continue) is run by you and governed by its own terms and policies.

## Contact
Open an issue at https://github.com/nihara96/ollama-browser-agent/issues
