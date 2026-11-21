import { DEFAULT_BRIDGE_PORT, type BridgeState } from "../../shared/protocol";

export interface BridgeSettings {
  bridgeEnabled: boolean;
  bridgePort: number;
}

export interface PanelSettings {
  model: string;
  ctx: string;
  confirmAll: boolean;
}

export const BRIDGE_DEFAULTS: BridgeSettings = {
  bridgeEnabled: false,
  bridgePort: DEFAULT_BRIDGE_PORT,
};

export const PANEL_DEFAULTS: PanelSettings = { model: "", ctx: "32768", confirmAll: false };

export function getBridgeSettings(): Promise<BridgeSettings> {
  return chrome.storage.local.get(BRIDGE_DEFAULTS) as Promise<BridgeSettings>;
}

export function saveBridgeSettings(s: Partial<BridgeSettings>): Promise<void> {
  return chrome.storage.local.set(s);
}

export function getPanelSettings(): Promise<PanelSettings> {
  return chrome.storage.local.get(PANEL_DEFAULTS) as Promise<PanelSettings>;
}

export function savePanelSettings(s: Partial<PanelSettings>): Promise<void> {
  return chrome.storage.local.set(s);
}

// Bridge runtime state lives in session storage so the side panel can observe the service worker.
export async function getBridgeState(): Promise<BridgeState> {
  const s = await chrome.storage.session.get({ bridgeState: "off" });
  return s.bridgeState as BridgeState;
}

export function setBridgeState(state: BridgeState): void {
  chrome.storage.session.set({ bridgeState: state }).catch(() => {});
}

export function recordBridgeActivity(tool: string): void {
  chrome.storage.session.set({ bridgeActivity: { tool, t: Date.now() } }).catch(() => {});
}
