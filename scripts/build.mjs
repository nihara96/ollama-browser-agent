// Bundles the extension and the MCP bridge with esbuild. Usage: node scripts/build.mjs [--watch]
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions[]} */
const configs = [
  {
    // Chrome extension: classic scripts (service worker + side panel page).
    entryPoints: {
      background: "ollama-agent/src/background.ts",
      sidepanel: "ollama-agent/src/sidepanel.ts",
    },
    outdir: "ollama-agent/dist",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    // Do NOT enable keepNames/minify identifiers: functions passed to chrome.scripting.executeScript
    // are serialized with toString() and must not reference helpers outside their own body.
  },
  {
    // MCP bridge: ESM bundle for Node, dependencies stay in node_modules.
    entryPoints: { server: "mcp-bridge/src/server.ts" },
    outdir: "mcp-bridge/dist",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    packages: "external",
    sourcemap: true,
  },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log("watching for changes...");
} else {
  await Promise.all(configs.map((c) => build(c)));
  console.log("build complete");
}
