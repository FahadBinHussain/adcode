import type { ToolCallBlock, ToolDefinition } from "../types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Some local models print their call envelope in content instead of tool_calls.
 * Accept only a reply made entirely of calls. Prose, code fences, ordinary JSON,
 * and partially generated envelopes stay text; never fish a call out of an example.
 * Recovered calls still pass through the agent's normal runner and review policy.
 */
export function localToolCalls(text: string, tools: readonly ToolDefinition[], idPrefix: string): ToolCallBlock[] | null {
  const source = text.trim();
  let values: unknown[];
  try {
    if (source.startsWith("<tool_call>")) {
      const envelopes = [...source.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
      if (envelopes.length === 0 || source.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim() !== "") return null;
      values = envelopes.map((match) => JSON.parse(match[1]!) as unknown);
    } else {
      const parsed: unknown = JSON.parse(source);
      values = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    return null;
  }
  if (values.length === 0 || values.length > 32) return null;

  const available = new Set(tools.map((tool) => tool.name));
  const calls: ToolCallBlock[] = [];
  for (const [index, value] of values.entries()) {
    if (!record(value)) return null;
    const nested = record(value["function"]);
    const envelope = nested ? value["function"] as Record<string, unknown> : value;
    const allowed = nested ? ["id", "type", "function"] : ["id", "name", "arguments"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
    if (nested && Object.keys(envelope).some((key) => key !== "name" && key !== "arguments")) return null;
    if (value["type"] !== undefined && value["type"] !== "function") return null;
    const name = envelope["name"];
    if (typeof name !== "string" || !/^[\w.-]+$/.test(name) || !("arguments" in envelope)) return null;

    let input: Record<string, unknown> = {};
    let inputError: string | undefined;
    try {
      const args: unknown = typeof envelope["arguments"] === "string"
        ? JSON.parse(envelope["arguments"]) as unknown
        : envelope["arguments"];
      if (!record(args)) throw new Error("Arguments must be an object");
      input = args;
    } catch {
      inputError = "Tool not run: the local model returned invalid JSON tool arguments. Retry with one call and an arguments object matching the tool schema.";
    }
    if (!available.has(name)) {
      inputError = `No tool named ${JSON.stringify(name)} is available. Choose an exact name from the provided tools: ${[...available].join(", ")}. To create a file, use propose_edit with path and contents when it is available.`;
    }
    calls.push({ type: "tool-call", id: `${idPrefix}_${index}`, name, input, ...(inputError === undefined ? {} : { inputError }) });
  }
  return calls;
}
