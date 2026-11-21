import { TOOL_DESCRIPTIONS, type ToolName } from "../../shared/protocol";

export const OLLAMA_URL = "http://localhost:11434";

export interface OllamaModel {
  name: string;
  size: number;
}

export interface OllamaToolCall {
  function: { name: string; arguments?: unknown };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface ToolSpec {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
  };
}

function spec(name: ToolName, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec {
  return {
    type: "function",
    function: { name, description: TOOL_DESCRIPTIONS[name], parameters: { type: "object", properties, required } },
  };
}

export const TOOLS: ToolSpec[] = [
  spec("get_page"),
  spec("click", { id: { type: "integer" } }, ["id"]),
  spec("type", { id: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" } }, ["id", "text"]),
  spec("scroll", { direction: { type: "string", enum: ["down", "up"] } }, ["direction"]),
  spec("navigate", { url: { type: "string" } }, ["url"]),
  spec("open_tab", { url: { type: "string" } }, ["url"]),
  spec("list_tabs"),
  spec("switch_tab", { tab_id: { type: "integer" } }, ["tab_id"]),
];

export async function listModels(): Promise<OllamaModel[]> {
  const r = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!r.ok) throw new Error(`Ollama error ${r.status}`);
  const j = (await r.json()) as { models?: OllamaModel[] };
  return j.models ?? [];
}

export interface ChatOptions {
  model: string;
  messages: OllamaMessage[];
  numCtx: number;
  signal?: AbortSignal;
}

export async function chat({ model, messages, numCtx, signal }: ChatOptions): Promise<OllamaMessage> {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOLS,
      stream: false,
      options: { num_ctx: numCtx, temperature: 0.3 },
    }),
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { message: OllamaMessage };
  return j.message;
}
