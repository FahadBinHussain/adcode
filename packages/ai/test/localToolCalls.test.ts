import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.ts";
import { createOllamaProvider, createOpenAiProvider } from "../src/providers/openaiCompatible.ts";
import { LIST_FILES, PROPOSE_EDIT } from "../src/tools.ts";
import type { AgentEvent, ProviderEvent, ProviderRequest, ToolCallBlock } from "../src/types.ts";

const request: ProviderRequest = {
  model: "qwen2.5-coder:7b-instruct-q4_K_M", system: "Use the available tools.",
  messages: [{ role: "user", content: [{ type: "text", text: "Create a page in this workspace" }] }],
  tools: [LIST_FILES, PROPOSE_EDIT], maxTokens: 1024,
};

function response(text: string, finish = "stop", native = false): Response {
  const chunks: unknown[] = [...text].map((content) => ({ choices: [{ delta: { content } }] }));
  if (native) chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "native", function: { name: "list_files", arguments: "{}" } }] } }] });
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n`);
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n`, "data: [DONE]\n");
  return new Response(lines.join(""));
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of stream) result.push(event);
  return result;
}

const textOf = (events: ProviderEvent[]) => events.filter((event) => event.kind === "text").map((event) => event.text).join("");

describe("local calls printed in content", () => {
  it.each([
    '{"name":"list_files","arguments":{}}',
    '[{"name":"list_files","arguments":"{}"}]',
    '<tool_call>{"name":"list_files","arguments":{}}</tool_call>',
    '{"type":"function","function":{"name":"list_files","arguments":{}}}',
  ])("executes a complete envelope split across tokens: %s", async (text) => {
    const provider = createOllamaProvider(undefined, vi.fn(async () => response(text)));
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(textOf(events)).toBe("");
    expect(events).toContainEqual({ kind: "tool-call", call: expect.objectContaining({ name: "list_files", input: {} }) });
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "tool-use" });
  });

  it("recovers multiple calls in order with distinct ids", async () => {
    const text = '<tool_call>{"name":"list_files","arguments":{}}</tool_call>\n<tool_call>{"name":"propose_edit","arguments":{"path":"index.html","contents":"<h1>Hi</h1>"}}</tool_call>';
    const events = await collect(createOllamaProvider(undefined, vi.fn(async () => response(text))).stream(request, new AbortController().signal));
    const calls = events.filter((event) => event.kind === "tool-call").map((event) => event.call);
    expect(calls.map((call) => call.name)).toEqual(["list_files", "propose_edit"]);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
  });

  it.each([
    'Here is an example: {"name":"propose_edit","arguments":{"path":"index.html","contents":"bad"}}',
    '```json\n{"name":"propose_edit","arguments":{"path":"index.html","contents":"bad"}}\n```',
    '{"name":"example","description":"ordinary data","arguments":{}}',
    '[{"name":"list_files","arguments":{}},{"message":"ordinary data"}]',
    '<tool_call>{"name":"list_files","arguments":{}}</tool_call> This is an example.',
    '{"name":"propose_edit","arguments":{"path":"index.html","contents":"partial',
  ])("leaves examples, data, and incomplete replies as text", async (text) => {
    const events = await collect(createOllamaProvider(undefined, vi.fn(async () => response(text))).stream(request, new AbortController().signal));
    expect(textOf(events)).toBe(text);
    expect(events.some((event) => event.kind === "tool-call")).toBe(false);
  });

  it.each(["length", "content_filter"])("never executes content from a %s reply", async (finish) => {
    const text = '{"name":"propose_edit","arguments":{"path":"index.html","contents":"partial"}}';
    const events = await collect(createOllamaProvider(undefined, vi.fn(async () => response(text, finish))).stream(request, new AbortController().signal));
    expect(events.some((event) => event.kind === "tool-call")).toBe(false);
    expect(textOf(events)).toBe(text);
  });

  it("keeps native calls authoritative without executing a duplicate from content", async () => {
    const text = '{"name":"list_files","arguments":{}}';
    const events = await collect(createOllamaProvider(undefined, vi.fn(async () => response(text, "tool_calls", true))).stream(request, new AbortController().signal));
    expect(events.filter((event) => event.kind === "tool-call")).toEqual([{ kind: "tool-call", call: { type: "tool-call", id: "native", name: "list_files", input: {} } }]);
  });

  it("does not reinterpret cloud replies or local replies with tools disabled", async () => {
    const text = '{"name":"list_files","arguments":{}}';
    const fetchImpl = vi.fn(async () => response(text));
    for (const [provider, input] of [[createOpenAiProvider("key", fetchImpl), request], [createOllamaProvider(undefined, fetchImpl), { ...request, tools: [] }]] as const) {
      const events = await collect(provider.stream(input, new AbortController().signal));
      expect(textOf(events)).toBe(text);
      expect(events.some((event) => event.kind === "tool-call")).toBe(false);
    }
  });

  it("streams normal local prose before the response finishes", async () => {
    const stream = createOllamaProvider(undefined, vi.fn(async () => response("Hello"))).stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    expect((await stream.next()).value).toEqual({ kind: "text", text: "H" });
    await stream.return?.();
  });

  it.each([
    ['{"name":"create_it","arguments":{}}', "No tool named"],
    ['{"name":"propose_edit","arguments":"{bad"}', "invalid JSON"],
    ['{"name":"propose_edit","arguments":[]}', "invalid JSON"],
  ])("returns correction feedback without running invalid calls", async (text, error) => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response(bodies.length === 1 ? text : '{"name":"propose_edit","arguments":{"path":"index.html","contents":"<h1>Hi</h1>"}}');
    });
    // After the corrected call, return a normal answer and end the loop.
    const runner = { run: vi.fn(async (_call: ToolCallBlock) => {
      fetchImpl.mockImplementation(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return response("Created index.html.");
      });
      return { content: "Edit staged for review", isError: false };
    }) };
    const agent = createAgent({ provider: createOllamaProvider(undefined, fetchImpl), model: request.model, tools: request.tools, runner });
    const events: AgentEvent[] = await collect(agent.send("Create a page"));
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls[0]?.[0]).toMatchObject({ name: "propose_edit", input: { path: "index.html", contents: "<h1>Hi</h1>" } });
    expect(events).toContainEqual(expect.objectContaining({ kind: "tool-result", isError: true, content: expect.stringContaining(error) }));
    expect(JSON.stringify(bodies[1])).toContain(error);
    expect(JSON.stringify(bodies[2])).toContain("tool_call_id");
    expect(events.at(-1)).toEqual({ kind: "turn-end", reason: "end-turn" });
  });

  it("stops an invented-tool retry loop after three failures", async () => {
    const fetchImpl = vi.fn(async () => response('{"name":"create_it","arguments":{}}'));
    const runner = { run: vi.fn() };
    const events = await collect(createAgent({ provider: createOllamaProvider(undefined, fetchImpl), model: request.model, tools: request.tools, runner }).send("Create a page"));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(runner.run).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ kind: "error", detail: expect.stringContaining("three identical failed calls") });
  });
});
