/** Chat history and GitHub access, with no container or running-capacity reservation. */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import { handleGitHubWorkspace } from "./githubWorkspace.ts";

const MAX_CHAT_BYTES = 512 * 1024;
const MAX_CHATS = 50;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

interface Repository { fullName: string; branch: string; commit: string }
interface Summary { id: string; title: string; updatedAt: number; repository?: Repository }
interface Chat extends Summary {
  messages: { role: "user" | "assistant"; content: string }[];
  proposals?: { path: string; content: string | null }[];
}

function reply(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function parseRepository(raw: unknown): Repository | null {
  if (!record(raw) || typeof raw.fullName !== "string" || !REPOSITORY.test(raw.fullName) ||
      typeof raw.branch !== "string" || raw.branch.length === 0 || raw.branch.length > 255 ||
      typeof raw.commit !== "string" || !/^[a-f0-9]{40,64}$/.test(raw.commit)) return null;
  return { fullName: raw.fullName, branch: raw.branch, commit: raw.commit };
}

function parseChat(raw: unknown, id: string, now: number): Chat | null {
  if (!record(raw) || raw.id !== id || typeof raw.title !== "string" || raw.title.length > 160 ||
      !Array.isArray(raw.messages) || raw.messages.length > 200) return null;
  const messages: Chat["messages"] = [];
  for (const message of raw.messages) {
    if (!record(message) || !["user", "assistant"].includes(String(message.role)) || typeof message.content !== "string") return null;
    messages.push({ role: message.role as "user" | "assistant", content: message.content });
  }
  const repository = raw.repository === undefined ? undefined : parseRepository(raw.repository);
  if (repository === null) return null;
  let proposals: Chat["proposals"];
  if (raw.proposals !== undefined) {
    if (!Array.isArray(raw.proposals) || raw.proposals.length > 50) return null;
    proposals = [];
    let total = 0;
    const seen = new Set<string>();
    for (const proposal of raw.proposals) {
      if (!record(proposal) || typeof proposal.path !== "string" || proposal.path.length === 0 || proposal.path.length > 500 ||
          proposal.path.startsWith("/") || proposal.path.includes("\\") || proposal.path.split("/").some(part => !part || part === "." || part === ".." || part === ".git") ||
          seen.has(proposal.path) || proposal.content !== null && typeof proposal.content !== "string") return null;
      const size = proposal.content === null ? 0 : bytes(proposal.content);
      if (size > 128 * 1024 || (total += size) > 256 * 1024) return null;
      seen.add(proposal.path);
      proposals.push({ path: proposal.path, content: proposal.content as string | null });
    }
  }
  return { id, title: raw.title.trim() || "New chat", updatedAt: now, messages, ...(repository ? { repository } : {}), ...(proposals ? { proposals } : {}) };
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_CHAT_BYTES) throw new RangeError("too-large");
  const reader = request.body?.getReader();
  if (reader === undefined) throw new SyntaxError("missing-body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if ((size += next.value.byteLength) > MAX_CHAT_BYTES) { await reader.cancel(); throw new RangeError("too-large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}

export class BrowserSession extends DurableObject<Env> {
  private async sealKey(): Promise<string> {
    let key = await this.ctx.storage.get<string>("sealKey");
    if (key === undefined) {
      key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      await this.ctx.storage.put("sealKey", key);
    }
    return key;
  }

  async fetch(request: Request): Promise<Response> {
    const uid = request.headers.get("x-adcode-uid");
    if (uid === null || uid.length === 0) return reply({ error: "Sign in first" }, 401);
    const owner = await this.ctx.storage.get<string>("uid");
    if (owner !== undefined && owner !== uid) return reply({ error: "Sign in first" }, 403);
    if (owner === undefined) await this.ctx.storage.put("uid", uid);
    const path = new URL(request.url).pathname;
    if (path.startsWith("/github/")) return handleGitHubWorkspace(request, this.ctx.storage, {
      uid, sealKey: await this.sealKey(), ...(this.env.GITHUB_CLIENT_ID ? { clientId: this.env.GITHUB_CLIENT_ID } : {}),
    });
    if (path === "/chats" && request.method === "GET") {
      const summaries = await this.ctx.storage.list<Summary>({ prefix: "summary:" });
      return reply({ chats: [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS) });
    }
    const match = /^\/chats\/([a-zA-Z0-9_-]{1,100})(\/restore)?$/.exec(path);
    if (match === null || !ID.test(match[1]!)) return reply({ error: "Not found" }, 404);
    const id = match[1]!;
    if (match[2] === "/restore") {
      if (request.method !== "POST") return reply({ error: "Use POST" }, 405);
      const restored = await this.ctx.storage.transaction(async storage => {
        const deleted = await storage.get<{ chat: Chat; deletedAt: number }>(`deleted:${id}`);
        if (deleted === undefined) return "missing" as const;
        if ((await storage.list({ prefix: "summary:", limit: MAX_CHATS })).size >= MAX_CHATS) return "full" as const;
        const chat = { ...deleted.chat, updatedAt: Date.now() };
        const { messages: _messages, proposals: _proposals, ...summary } = chat;
        await storage.put({ [`chat:${id}`]: chat, [`summary:${id}`]: summary });
        await storage.delete(`deleted:${id}`);
        return chat;
      });
      return restored === "missing" ? reply({ error: "This deleted chat could not be found" }, 404)
        : restored === "full" ? reply({ error: "Your saved chats are full. Delete another chat before restoring this one." }, 409) : reply(restored);
    }
    if (request.method === "DELETE") {
      await this.ctx.storage.transaction(async storage => {
        const chat = await storage.get<Chat>(`chat:${id}`);
        if (chat === undefined) return;
        await storage.put(`deleted:${id}`, { chat, deletedAt: Date.now() });
        await storage.delete([`chat:${id}`, `summary:${id}`]);
        const deleted = await storage.list<{ deletedAt: number }>({ prefix: "deleted:" });
        const expired = [...deleted.entries()].sort(([, a], [, b]) => b.deletedAt - a.deletedAt).slice(10).map(([key]) => key);
        if (expired.length > 0) await storage.delete(expired);
      });
      return reply({ ok: true });
    }
    if (request.method === "GET") {
      const chat = await this.ctx.storage.get<Chat>(`chat:${id}`);
      return chat === undefined ? reply({ error: "This chat could not be found" }, 404) : reply(chat);
    }
    if (request.method !== "PUT") return reply({ error: "Use GET or PUT" }, 405);
    let raw: unknown;
    try { raw = await readBody(request); }
    catch (error) { return reply({ error: error instanceof RangeError ? "This chat is too large to save. Start a new chat." : "Send a valid chat" }, error instanceof RangeError ? 413 : 400); }
    const chat = parseChat(raw, id, Date.now());
    if (chat === null) return reply({ error: "Send a valid chat" }, 400);
    const summary: Summary = { id, title: chat.title, updatedAt: chat.updatedAt, ...(chat.repository ? { repository: chat.repository } : {}) };
    const saved = await this.ctx.storage.transaction(async storage => {
      const existing = await storage.get<Summary>(`summary:${id}`);
      if (existing === undefined && (await storage.list({ prefix: "summary:", limit: MAX_CHATS })).size >= MAX_CHATS) return false;
      await storage.put({ [`chat:${id}`]: chat, [`summary:${id}`]: summary });
      return true;
    });
    return saved ? reply(chat) : reply({ error: "Your saved chats are full. Continue an existing chat." }, 409);
  }
}
