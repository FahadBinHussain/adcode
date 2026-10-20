import { describe, expect, it, vi } from "vitest";
import { BrowserApiError, createBrowserClient } from "../src/web/browserClient.ts";
import { BROWSER_LIMITS, type BrowserChat, type BrowserTurnEvent } from "../src/web/browserTypes.ts";

const COMMIT = "a".repeat(40);
const baseChat = (): BrowserChat => ({ id: "chat-1", title: "New chat", updatedAt: 1, messages: [] });
const repository = { fullName: "person/project", branch: "main", commit: COMMIT };
const config = { available: true, defaultModel: "model", models: [{ id: "model", name: "Included model", contextWindow: 131072, maxOutput: 8192 }] };
const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
const textReply = (text = "Hello"): string => event({ choices: [{ delta: { content: text }, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
const toolReply = (name: string, input: unknown, id = "call-1"): string => event({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n";
const sse = (text: string): Response => new Response(text, { headers: { "content-type": "text/event-stream", "x-adcode-request-id": "request-1" } });

function fixture(replies: (Response | (() => Response))[] = [sse(textReply())]) {
  let token = 0;
  const refresh = vi.fn(async () => `fresh-${++token}`);
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "https://web.bluethenics.com");
    if (url.pathname === "/v1/ai/tagflow/config") return Response.json(config);
    if (url.pathname === "/v1/ai/tagflow/chat/completions") {
      const reply = replies.shift();
      if (reply === undefined) throw new Error("Unexpected model round");
      return typeof reply === "function" ? reply() : reply;
    }
    if (url.pathname === "/api/github/tree") return Response.json({ repo: repository.fullName, ref: COMMIT, commit: COMMIT, files: [{ path: "src/main.ts", sha: "file-sha", size: 20 }], truncated: false });
    if (url.pathname === "/api/github/file") return Response.json({ path: "src/main.ts", sha: "file-sha", content: "export const n = 1;", bytes: 19 });
    return Response.json({ ok: true });
  });
  const client = createBrowserClient({ refresh }, { fetchImpl });
  const events: BrowserTurnEvent[] = [];
  const options = { chat: baseChat(), text: "Explain this code", model: "model", signal: new AbortController().signal, onEvent: (value: BrowserTurnEvent) => { events.push(value); } };
  const modelCalls = () => fetchImpl.mock.calls.filter(([url]) => String(url) === "/v1/ai/tagflow/chat/completions");
  return { client, fetchImpl, refresh, events, options, modelCalls };
}

describe("browser workspace client", () => {
  it("streams an included reply without a sandbox and refreshes credentials for each request", async () => {
    const { client, options, fetchImpl, events, modelCalls } = fixture();
    const result = await client.streamTurn(options);
    expect(result.chat.messages).toEqual([{ role: "user", content: "Explain this code" }, { role: "assistant", content: "Hello" }]);
    expect(result.chat.title).toBe("Explain this code");
    expect(result.requestId).toBe("request-1");
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    const init = modelCalls()[0]![1]!;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fresh-2");
    expect(new Headers(init.headers).get("x-adcode-ai-source")).toBe("chat");
    expect(new Headers(init.headers).get("x-adcode-platform")).toBe("web");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("tools");
    expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith("/v1/ai/tagflow/"))).toBe(true);
  });

  it("decodes fragmented UTF-8 SSE and usage frames", async () => {
    const bytes = new TextEncoder().encode(event({ choices: [{ delta: { content: "Hi 👋" }, finish_reason: "stop" }] }) + event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } }) + "data: [DONE]\n\n");
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
    const { client, options, events } = fixture([new Response(body, { headers: { "content-type": "text/event-stream" } })]);
    expect((await client.streamTurn(options)).chat.messages.at(-1)?.content).toBe("Hi 👋");
    expect(events).toContainEqual({ type: "usage", inputTokens: 12, outputTokens: 4 });
  });

  it("passes readable allowance errors through with retry information", async () => {
    const { client, options } = fixture([Response.json({ error: { code: "daily-limit", message: "Your free credits refill later." } }, { status: 429, headers: { "retry-after": "60" } })]);
    await expect(client.streamTurn(options)).rejects.toMatchObject({ name: "BrowserApiError", status: 429, code: "daily-limit", message: "Your free credits refill later.", retryAfter: "60" });
  });

  it.each(["session", "weekly"])("uses manual retry copy for a %s credit refill", async (limit) => {
    const { client, options } = fixture([Response.json({ error: { code: "daily-limit", limit, message: "You've used your free AI credits. They refill in 2 hours, and this task resumes by itself then. All free models share one credit balance.", retryable: true } }, { status: 429, headers: { "retry-after": "7200" } })]);
    await expect(client.streamTurn(options)).rejects.toMatchObject({ code: "daily-limit", retryAfter: "7200", message: "You've used your free AI credits. They refill in 2 hours. Retry when your credits refill. All free models share one credit balance." });
  });

  it("keeps a non-retryable zero-credit explanation intact", async () => {
    const explanation = "Free AI credits are set to zero for this account, so waiting will not help.";
    const { client, options } = fixture([Response.json({ error: { code: "daily-limit", message: explanation, retryable: false } }, { status: 429 })]);
    await expect(client.streamTurn(options)).rejects.toMatchObject({ message: explanation });
  });

  it("retains a token-capped plain reply and marks it as truncated", async () => {
    const reply = event({ choices: [{ delta: { content: "The first part of the answer" }, finish_reason: "length" }] }) + "data: [DONE]\n\n";
    const { client, options } = fixture([sse(reply)]);
    const result = await client.streamTurn(options);
    expect(result.truncated).toBe(true);
    expect(result.chat.messages.at(-1)?.content).toBe("The first part of the answer");
  });

  it.each([
    '{"path":"src/main.ts","content":"unfinished',
    JSON.stringify({ path: "src/main.ts", content: "export const n = 2;" }),
  ])("never stages a file operation from a token-capped tool reply", async (args) => {
    const reply = event({ choices: [{ delta: { tool_calls: [{ index: 0, id: "change-1", function: { name: "propose_file", arguments: args } }] }, finish_reason: "length" }] }) + "data: [DONE]\n\n";
    const { client, options, events, modelCalls, fetchImpl } = fixture([sse(reply)]);
    await expect(client.streamTurn({ ...options, chat: { ...baseChat(), repository } })).rejects.toThrow("No changes from this reply were staged");
    expect(events.some((one) => one.type === "proposal")).toBe(false);
    expect(modelCalls()).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).startsWith("/api/github/"))).toBe(false);
  });

  it.each([
    { name: "empty", reply: "data: [DONE]\n\n", message: "empty reply" },
    { name: "interrupted", reply: event({ choices: [{ delta: { content: "Partial" } }] }), message: "interrupted" },
    { name: "oversized", reply: `data: ${"x".repeat(600000)}`, message: "oversized" },
  ])("rejects $name replies", async ({ reply, message }) => {
    const { client, options } = fixture([sse(reply)]);
    await expect(client.streamTurn(options)).rejects.toThrow(message);
  });

  it("cancels an active stream and never starts repository tools after cancellation", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: "Partial" } }] }))); }, cancel });
    const { client, options, events, fetchImpl } = fixture([new Response(body, { headers: { "content-type": "text/event-stream" } })]);
    const work = client.streamTurn({ ...options, signal: abort.signal, onEvent(value) { events.push(value); if (value.type === "text") abort.abort(); } });
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls.some(([url]) => String(url).startsWith("/api/github/"))).toBe(false);
  });

  it("reads an immutable repository commit, stages a proposal, and leaves publishing to review", async () => {
    const { client, options, events, fetchImpl, modelCalls } = fixture([
      sse(toolReply("read_file", { path: "src/main.ts" })),
      sse(toolReply("propose_file", { path: "src/main.ts", content: "export const n = 2;" })),
      sse(textReply("I staged the change for review.")),
    ]);
    const result = await client.streamTurn({ ...options, chat: { ...baseChat(), repository } });
    expect(result.chat.proposals).toEqual([{ path: "src/main.ts", content: "export const n = 2;" }]);
    expect(events).toContainEqual({ type: "proposal", proposal: { path: "src/main.ts", content: "export const n = 2;" }, previousContent: "export const n = 1;" });
    const fileRequest = fetchImpl.mock.calls.find(([url]) => String(url).startsWith("/api/github/file"))![0];
    expect(new URL(String(fileRequest), "https://web.bluethenics.com").searchParams.get("ref")).toBe(COMMIT);
    const finalInput = JSON.parse(String(modelCalls()[2]![1]!.body));
    expect(finalInput.messages).toContainEqual(expect.objectContaining({ role: "tool", content: expect.stringContaining("Staged for review") }));
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("pull-request") || String(url).includes("/socket"))).toBe(false);
  });

  it("loads selected context files before asking the model", async () => {
    const { client, options, modelCalls } = fixture();
    await client.streamTurn({ ...options, chat: { ...baseChat(), repository }, selectedPaths: ["src/main.ts"] });
    const sent = JSON.parse(String(modelCalls()[0]![1]!.body));
    expect(sent.messages.at(-1).content).toContain("export const n = 1;");
  });

  it("reassembles streamed tool arguments before reading the file", async () => {
    const fragments = event({ choices: [{ delta: { tool_calls: [{ index: 0, id: "read-1", function: { name: "read_file", arguments: '{"path":"src/' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'main.ts"}' } }] }, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n";
    const { client, options, fetchImpl } = fixture([sse(fragments), sse(textReply("The file exports one constant."))]);
    await client.streamTurn({ ...options, chat: { ...baseChat(), repository } });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).startsWith("/api/github/file"))).toHaveLength(1);
  });

  it("rejects an empty final response even after earlier tool narration", async () => {
    const narrated = event({ choices: [{ delta: { content: "I will check the files." } }] }) + toolReply("list_files", {});
    const { client, options } = fixture([sse(narrated), sse("data: [DONE]\n\n")]);
    await expect(client.streamTurn({ ...options, chat: { ...baseChat(), repository } })).rejects.toThrow("empty reply");
  });

  it("returns invalid paths as tool errors and never fetches files outside the selected tree", async () => {
    const { client, options, fetchImpl, modelCalls } = fixture([sse(toolReply("read_file", { path: "../secret" })), sse(textReply("That path is unavailable."))]);
    await client.streamTurn({ ...options, chat: { ...baseChat(), repository } });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).startsWith("/api/github/file"))).toBe(false);
    expect(JSON.parse(String(modelCalls()[1]![1]!.body)).messages.at(-1).content).toContain("valid repository-relative");
  });

  it("bounds the repository agent loop", async () => {
    const { client, options, modelCalls } = fixture(Array.from({ length: 6 }, (_, index) => sse(toolReply("list_files", {}, `call-${index}`))));
    await expect(client.streamTurn({ ...options, chat: { ...baseChat(), repository } })).rejects.toThrow("six-step limit");
    expect(modelCalls()).toHaveLength(6);
  });

  it("rejects oversized proposals before sending a pull request", async () => {
    const { client, fetchImpl } = fixture();
    await expect(client.publishPullRequest({ repo: repository.fullName, baseBranch: "main", baseCommit: COMMIT, title: "Change", body: "", files: [{ path: "big.ts", content: "x".repeat(BROWSER_LIMITS.proposalFileBytes + 1) }] })).rejects.toThrow("128 KB");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the server-owned GitHub authorization flow without device credentials", async () => {
    const { client, fetchImpl } = fixture();
    await client.githubStart();
    await client.githubPoll();
    await client.githubDisconnect();
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ["/api/github/start", "POST", undefined], ["/api/github/poll", "POST", undefined], ["/api/github/disconnect", "POST", undefined],
    ]);
  });

  it("deletes and restores one conversation through the authenticated history routes", async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockImplementation(async (_url, init) => init?.method === "POST" ? Response.json(baseChat()) : new Response(null, { status: 204 }));
    await client.deleteChat("chat-1");
    expect(await client.restoreChat("chat-1")).toEqual(baseChat());
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method, new Headers(init?.headers).get("authorization")])).toEqual([
      ["/api/chats/chat-1", "DELETE", "Bearer fresh-1"], ["/api/chats/chat-1/restore", "POST", "Bearer fresh-2"],
    ]);
  });

  it("refuses signed-out requests before fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createBrowserClient({ refresh: async () => null }, { fetchImpl });
    await expect(client.listChats()).rejects.toBeInstanceOf(BrowserApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never sends a private conversation under a different account after token refresh", async () => {
    const { client, refresh, options, modelCalls } = fixture();
    const token = (sub: string): string => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
    refresh.mockResolvedValueOnce(token("account-a")).mockResolvedValueOnce(token("account-b"));
    await expect(client.streamTurn(options)).rejects.toMatchObject({ code: "account-changed" });
    expect(modelCalls()).toHaveLength(0);
  });
});
