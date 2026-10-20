import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {
  constructor(protected ctx: DurableObjectState, protected env: Env) {}
} }));
vi.mock("../src/githubWorkspace.ts", () => ({ handleGitHubWorkspace: vi.fn(async () => Response.json({ connected: false })) }));
import { BrowserSession } from "../src/browserSession.ts";
import { handleGitHubWorkspace } from "../src/githubWorkspace.ts";

function fixture() {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") values.set(key, value);
      else for (const [name, item] of Object.entries(key)) values.set(name, item);
    }),
    delete: vi.fn(async (key: string | string[]) => {
      for (const name of typeof key === "string" ? [key] : key) values.delete(name);
    }),
    list: vi.fn(async ({ prefix, limit }: { prefix: string; limit?: number }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).slice(0, limit))),
    transaction: vi.fn(async (work: (storage: unknown) => Promise<unknown>) => work(storage)),
  };
  const ctx = { storage } as unknown as DurableObjectState;
  const session = new BrowserSession(ctx, {} as Env);
  return { session, values, ctx, storage };
}
const chat = (id = "chat_1") => ({ id, title: "Explain the project", updatedAt: 1, messages: [{ role: "user", content: "What does this code do?" }], proposals: [] });
const req = (path: string, init: RequestInit = {}, uid = "person") => new Request(`https://browser.session${path}`, { ...init, headers: { "x-adcode-uid": uid, ...init.headers } });

beforeEach(() => vi.clearAllMocks());

describe("chat storage without a coding workspace", () => {
  it("saves history and restores it after an object restart, returning only summaries in the list", async () => {
    const { session, ctx } = fixture();
    const saved = await session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(chat()) }));
    expect(saved.status).toBe(200);
    const savedChat = await saved.json() as { updatedAt: number };
    expect(savedChat.updatedAt).toBeGreaterThan(1);
    const restarted = new BrowserSession(ctx, {} as Env);
    expect(await (await restarted.fetch(req("/chats/chat_1"))).json()).toMatchObject({ messages: chat().messages });
    const history = await (await restarted.fetch(req("/chats"))).json() as { chats: Record<string, unknown>[] };
    expect(history.chats).toHaveLength(1);
    expect(history.chats[0]).toMatchObject({ id: "chat_1", title: "Explain the project" });
    expect(history.chats[0]).not.toHaveProperty("messages");
    expect(history.chats[0]).not.toHaveProperty("proposals");
  });

  it("rejects a missing or mismatched account without exposing saved conversation content", async () => {
    const { session } = fixture();
    await session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(chat()) }));
    expect((await session.fetch(new Request("https://browser.session/chats"))).status).toBe(401);
    const other = await session.fetch(req("/chats/chat_1", {}, "someone-else"));
    expect(other.status).toBe(403);
    expect(await other.text()).not.toContain("What does this code do");
  });

  it("keeps each account's saved history independent", async () => {
    const first = fixture(); const second = fixture();
    await first.session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(chat()) }));
    expect(await (await second.session.fetch(req("/chats", {}, "second"))).json()).toEqual({ chats: [] });
  });

  it("frees a saved-chat slot with recoverable deletion and restores the original messages", async () => {
    const { session, values } = fixture();
    await session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(chat()) }));
    expect((await session.fetch(req("/chats/chat_1", { method: "DELETE" }))).status).toBe(200);
    expect(await (await session.fetch(req("/chats"))).json()).toEqual({ chats: [] });
    expect((await session.fetch(req("/chats/chat_1"))).status).toBe(404);
    expect(values.has("deleted:chat_1")).toBe(true);
    const restored = await session.fetch(req("/chats/chat_1/restore", { method: "POST" }));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: "chat_1", messages: chat().messages });
    expect(values.has("deleted:chat_1")).toBe(false);
  });

  it("bounds deleted-chat storage while retaining ten recent recoverable conversations", async () => {
    const { session, values } = fixture();
    for (let i = 0; i < 12; i++) {
      const id = `chat_${i}`;
      await session.fetch(req(`/chats/${id}`, { method: "PUT", body: JSON.stringify(chat(id)) }));
      await session.fetch(req(`/chats/${id}`, { method: "DELETE" }));
    }
    expect([...values.keys()].filter(key => key.startsWith("deleted:"))).toHaveLength(10);
    expect([...values.keys()].filter(key => key.startsWith("summary:"))).toHaveLength(0);
  });

  it("bounds stored history while allowing an existing conversation to continue", async () => {
    const { session, values } = fixture();
    for (let i = 0; i < 50; i++) values.set(`summary:chat_${i}`, { id: `chat_${i}`, title: "Saved", updatedAt: i });
    const full = await session.fetch(req("/chats/new_chat", { method: "PUT", body: JSON.stringify(chat("new_chat")) }));
    expect(full.status).toBe(409);
    expect(values.has("chat:new_chat")).toBe(false);
    expect((await session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(chat()) }))).status).toBe(200);
  });

  it.each([
    { ...chat(), id: "other" },
    { ...chat(), messages: [{ role: "system", content: "injected" }] },
    { ...chat(), proposals: [{ path: "../escape", content: "bad" }] },
    { ...chat(), proposals: [{ path: "src/file.ts", content: "x".repeat(129 * 1024) }] },
    { ...chat(), repository: { fullName: "owner/repo", branch: "main", commit: "not-a-commit" } },
  ])("rejects invalid transcript/proposal data instead of storing it", async raw => {
    const { session, values } = fixture();
    expect((await session.fetch(req("/chats/chat_1", { method: "PUT", body: JSON.stringify(raw) }))).status).toBe(400);
    expect(values.has("chat:chat_1")).toBe(false);
  });

  it("rejects oversized chunked bodies even without Content-Length", async () => {
    const { session, values } = fixture();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(513 * 1024)); controller.close(); } });
    const incoming = req("/chats/chat_1", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
    expect((await session.fetch(incoming)).status).toBe(413);
    expect(values.has("chat:chat_1")).toBe(false);
  });

  it("keeps GitHub credentials behind an account-scoped handler without a container binding", async () => {
    const { session, storage } = fixture();
    expect((await session.fetch(req("/github/status"))).status).toBe(200);
    expect(handleGitHubWorkspace).toHaveBeenCalledWith(expect.any(Request), storage, expect.objectContaining({ uid: "person", sealKey: expect.any(String) }));
  });
});
