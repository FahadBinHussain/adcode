import { describe, expect, it, vi } from "vitest";
import { handleGitHubWorkspace } from "../src/githubWorkspace.ts";

const BASE = "a".repeat(40); const TREE = "b".repeat(40); const BLOB = "c".repeat(40); const CREATED = "d".repeat(40);
const SECRET = "github-private-access-token";
function fixture() {
  const values = new Map<string, unknown>(); let time = 1_000_000;
  // Serialize transaction callbacks like the per-user DO storage, including concurrent polls.
  let tail: Promise<unknown> = Promise.resolve();
  const port = {
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, item] of Object.entries(key)) values.set(name, structuredClone(item));
    }),
    delete: vi.fn(async (key: string | string[]) => { for (const item of typeof key === "string" ? [key] : key) values.delete(item); }),
    transaction: vi.fn((work: (transaction: typeof port) => Promise<unknown>): Promise<unknown> => {
      const result = tail.then(() => work(port)); tail = result.catch(() => undefined); return result;
    }),
  };
  const calls: { path: string; method: string; body: unknown; headers: Headers; redirect: RequestRedirect | undefined }[] = [];
  const respond = vi.fn(async (path: string, _method: string, _body: unknown): Promise<Response> => {
    if (path === "/login/device/code") return Response.json({ device_code: "private-device-code", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 });
    if (path === "/login/oauth/access_token") return Response.json({ access_token: SECRET });
    if (path === "/user") return Response.json({ login: "person", id: 1 });
    if (path.startsWith("/user/repos?")) return Response.json([{ full_name: "owner/project", default_branch: "main", private: true, permissions: { push: true } }], { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } });
    if (path === "/repos/owner/project/commits/main") return Response.json({ sha: BASE, commit: { tree: { sha: TREE } } });
    if (path.includes("/git/ref/heads/")) return Response.json({ object: { sha: BASE } });
    if (path === `/repos/owner/project/git/commits/${BASE}`) return Response.json({ tree: { sha: TREE } });
    if (path.includes("/git/trees/") && path.endsWith("?recursive=1")) return Response.json({ truncated: false, tree: [
      { path: "src/main.ts", type: "blob", mode: "100644", sha: BLOB, size: 12 },
      { path: "run.sh", type: "blob", mode: "100755", sha: BLOB, size: 12 },
      { path: ".env", type: "blob", mode: "100644", sha: BLOB, size: 12 },
      { path: "linked", type: "blob", mode: "120000", sha: BLOB, size: 12 },
    ] });
    if (path.includes("/contents/")) return Response.json({ type: "file", encoding: "base64", content: btoa("hello\n"), size: 6, sha: BLOB });
    if (path.endsWith("/git/blobs") || path.endsWith("/git/trees")) return Response.json({ sha: TREE });
    if (path.endsWith("/git/commits")) return Response.json({ sha: CREATED });
    if (path.endsWith("/git/refs")) return Response.json({ ref: "created" });
    if (path.endsWith("/pulls")) return Response.json({ html_url: "https://github.com/owner/project/pull/7", number: 7 });
    return Response.json({ unexpected: path }, { status: 500 });
  });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const path = url.pathname + url.search;
    const body = init?.body === undefined ? undefined : url.hostname === "github.com" ? Object.fromEntries(new URLSearchParams(String(init.body))) : JSON.parse(String(init.body));
    calls.push({ path, method: init?.method ?? "GET", body, headers: new Headers(init?.headers), redirect: init?.redirect });
    return respond(path, init?.method ?? "GET", body);
  });
  const storage = port as unknown as DurableObjectStorage;
  const options = { uid: "person", sealKey: btoa("k".repeat(32)), fetcher: fetcher as typeof fetch, now: () => time };
  const call = (path: string, method = "GET", body?: unknown, override?: Partial<typeof options>) => handleGitHubWorkspace(new Request(`https://user.session/github/${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }), storage, { ...options, ...override });
  const authorize = async () => { await call("start", "POST"); time += 5000; expect(await (await call("poll", "POST")).json()).toEqual({ state: "connected", login: "person" }); calls.length = 0; respond.mockClear(); };
  return { values, storage, options, call, authorize, calls, respond, fetcher, advance: (ms: number) => { time += ms; } };
}
const change = (files = [{ path: "src/main.ts", content: "updated" }]) => ({ repo: "owner/project", baseBranch: "main", baseCommit: BASE, title: "Improve app", body: "Reviewed changes", files });

describe("GitHub connection without a sandbox", () => {
  it("keeps the device code and encrypted token off the wire, and scopes both to the user", async () => {
    const f = fixture();
    const start = await (await f.call("start", "POST")).json();
    expect(start).toEqual({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: 1_900_000, intervalMs: 5000 });
    expect(JSON.stringify(start)).not.toContain("private-device-code");
    expect(await (await f.call("poll", "POST")).json()).toEqual({ state: "pending", retryAfterMs: 5000 });
    expect(f.calls.filter(x => x.path === "/login/oauth/access_token")).toHaveLength(0);
    f.advance(5000);
    await f.call("poll", "POST");
    expect(JSON.stringify([...f.values])).not.toContain(SECRET);
    expect(await (await f.call("status")).json()).toEqual({ connected: true, login: "person" });
    expect(await (await f.call("status", "GET", undefined, { uid: "another" })).json()).toEqual({ connected: false, login: null });
    expect(await (await f.call("status", "GET", undefined, { sealKey: btoa("z".repeat(32)) })).json()).toEqual({ connected: false, login: null });
    expect(f.calls.every(x => x.redirect === "manual")).toBe(true);
    expect(f.calls.find(x => x.path === "/login/device/code")?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("persists slow_down, expires device flows and accepts at most one concurrent poll", async () => {
    const f = fixture(); await f.call("start", "POST"); f.advance(5000);
    f.respond.mockImplementation(async path => path === "/login/oauth/access_token" ? Response.json({ error: "slow_down" }) : Response.json({}));
    const results = await Promise.all([f.call("poll", "POST"), f.call("poll", "POST")]);
    expect(f.calls.filter(x => x.path === "/login/oauth/access_token")).toHaveLength(1);
    expect(await results[0]!.json()).toEqual({ state: "pending", retryAfterMs: 10_000 });
    expect(await (await f.call("poll", "POST")).json()).toEqual({ state: "pending", retryAfterMs: 10_000 });
    f.advance(900_000); expect(await (await f.call("poll", "POST")).json()).toEqual({ state: "expired" });
  });

  it("does not save a token when disconnect races with authorization", async () => {
    const f = fixture(); await f.call("start", "POST"); f.advance(5000);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    f.respond.mockImplementation(async path => {
      if (path === "/login/oauth/access_token") { await pending; return Response.json({ access_token: SECRET }); }
      return Response.json({ login: "person" });
    });
    const polling = f.call("poll", "POST");
    await vi.waitFor(() => expect(f.calls.some(x => x.path === "/login/oauth/access_token")).toBe(true));
    await f.call("disconnect", "POST"); release();
    expect(await (await polling).json()).toEqual({ state: "expired" });
    expect(await (await f.call("status")).json()).toEqual({ connected: false, login: null });
  });

  it("rejects unsupported routes/methods and reconnects without revealing upstream errors", async () => {
    const f = fixture(); expect((await f.call("repos")).status).toBe(401);
    expect((await f.call("https://evil.test")).status).toBe(404);
    expect((await f.call("start")).status).toBe(405);
    await f.authorize();
    f.respond.mockResolvedValue(Response.json({ message: SECRET }, { status: 401 }));
    const response = await f.call("repos"); expect(response.status).toBe(401); expect(await response.text()).not.toContain(SECRET);
    await f.call("disconnect", "POST"); expect(await (await f.call("status")).json()).toEqual({ connected: false, login: null });
  });
});

describe("GitHub repository context", () => {
  it("cancels an in-flight GitHub file read when its browser request stops", async () => {
    const f = fixture(); await f.authorize();
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | null | undefined;
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => { started = resolve; });
    f.fetcher.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init?.signal;
      upstreamSignal?.addEventListener("abort", () => reject(upstreamSignal?.reason), { once: true });
      started();
    }));
    const result = handleGitHubWorkspace(new Request(`https://browser.session/github/file?repo=owner/project&ref=${BASE}&path=src/main.ts`, { signal: controller.signal }), f.storage, f.options);
    await fetching;
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    const response = await result;
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRET);
  });

  it("lists repositories and reads bounded files at immutable commits", async () => {
    const f = fixture(); await f.authorize();
    expect(await (await f.call("repos?page=1")).json()).toEqual({ repos: [{ fullName: "owner/project", defaultBranch: "main", private: true, canPush: true, htmlUrl: "https://github.com/owner/project" }], nextPage: 2 });
    const tree = await (await f.call("tree?repo=owner/project&ref=main")).json();
    expect(tree).toMatchObject({ repo: "owner/project", ref: "main", commit: BASE, truncated: false });
    expect(tree.files.map((x: { path: string }) => x.path)).toEqual(["src/main.ts", "run.sh"]);
    expect(await (await f.call(`file?repo=owner/project&ref=${BASE}&path=src/main.ts`)).json()).toEqual({ path: "src/main.ts", sha: BLOB, content: "hello\n", bytes: 6 });
    expect((await f.call("file?repo=owner/project&ref=main&path=src/main.ts")).status).toBe(400);
    expect(f.calls.every(x => x.headers.get("authorization") === `Bearer ${SECRET}`)).toBe(true);
  });

  it.each(["../outside", ".git/config", ".env", ".env.production", ".aws/credentials", ".npmrc", "private.pem", "src\\outside"])("excludes unsafe or credential path %s before any GitHub request", async path => {
    const f = fixture(); await f.authorize();
    const response = await f.call(`file?repo=owner/project&ref=${BASE}&path=${encodeURIComponent(path)}`);
    expect([400, 403]).toContain(response.status); expect(f.calls).toHaveLength(0);
  });

  it("rejects an oversized response without trusting its declared file size", async () => {
    const f = fixture(); await f.authorize();
    f.respond.mockResolvedValue(Response.json({ type: "file", size: 1, encoding: "base64", sha: BLOB, content: btoa("a".repeat(256_001)) }));
    expect((await f.call(`file?repo=owner/project&ref=${BASE}&path=big.txt`)).status).toBe(413);
  });
});

describe("reviewed repository changes", () => {
  it("creates one commit and PR on a new branch, preserving executable modes and the base tree", async () => {
    const f = fixture(); await f.authorize();
    const response = await f.call("pull-request", "POST", change([{ path: "run.sh", content: "#!/bin/sh\necho ok" }, { path: "new.txt", content: "new" }]));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ url: "https://github.com/owner/project/pull/7", number: 7, branch: expect.stringMatching(/^adcode\//) });
    const tree = f.calls.find(x => x.path.endsWith("/git/trees"))?.body;
    expect(tree).toMatchObject({ base_tree: TREE, tree: [{ path: "run.sh", mode: "100755", type: "blob" }, { path: "new.txt", mode: "100644", type: "blob" }] });
    expect(f.calls.find(x => x.path.endsWith("/git/commits"))?.body).toEqual({ message: "Improve app", tree: TREE, parents: [BASE] });
    expect(f.calls.find(x => x.path.endsWith("/git/refs"))?.body).toMatchObject({ ref: expect.stringMatching(/^refs\/heads\/adcode\//), sha: CREATED });
    expect(f.calls.every(x => !["PATCH", "PUT", "DELETE"].includes(x.method))).toBe(true);
  });

  it("rejects a moved base before writing Git objects", async () => {
    const f = fixture(); await f.authorize(); f.respond.mockResolvedValue(Response.json({ object: { sha: CREATED } }));
    const response = await f.call("pull-request", "POST", change());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "base-moved" } });
    expect(f.calls.filter(x => x.method !== "GET")).toHaveLength(0);
  });

  it("rechecks the base after preparing objects and never publishes a stale branch", async () => {
    const f = fixture(); await f.authorize();
    const original = f.respond.getMockImplementation()!; let checks = 0;
    f.respond.mockImplementation(async (path, method, body) => path.includes("/git/ref/heads/") && ++checks > 1 ? Response.json({ object: { sha: CREATED } }) : original(path, method, body));
    const response = await f.call("pull-request", "POST", change()); expect(response.status).toBe(409);
    expect(f.calls.some(x => x.path.endsWith("/git/refs") || x.path.endsWith("/pulls"))).toBe(false);
  });

  it.each([
    { files: [{ path: ".github/workflows/build.yml", content: "changed" }], status: 403 },
    { files: [{ path: ".env", content: "changed" }], status: 403 },
    { files: [{ path: "src/main.ts", content: "a" }, { path: "src/main.ts", content: "b" }], status: 400 },
    { files: [{ path: "src/main.ts", content: "a".repeat(256_001) }], status: 413 },
  ])("rejects unsafe or oversized edits before writes ($status)", async ({ files, status }) => {
    const f = fixture(); await f.authorize(); const response = await f.call("pull-request", "POST", change(files));
    expect(response.status).toBe(status); expect(f.calls).toHaveLength(0);
  });

  it("rejects oversized streamed requests before creating any Git objects", async () => {
    const f = fixture(); await f.authorize();
    const response = await f.call("pull-request", "POST", { ...change(), body: "a".repeat(1_500_001) });
    expect(response.status).toBe(413); expect(f.calls).toHaveLength(0);
  });

  it("refuses truncated base trees and symlink edits without publishing anything", async () => {
    const f = fixture(); await f.authorize();
    const symlink = await f.call("pull-request", "POST", change([{ path: "linked", content: "unsafe" }]));
    expect(symlink.status).toBe(400); expect(f.calls.every(x => x.method === "GET")).toBe(true);
    const original = f.respond.getMockImplementation()!;
    f.respond.mockImplementation(async (path, method, body) => path.includes("/git/trees/") ? Response.json({ truncated: true, tree: [] }) : original(path, method, body));
    const truncated = await f.call("pull-request", "POST", change()); expect(truncated.status).toBe(413);
    expect(f.calls.every(x => x.method === "GET")).toBe(true);
  });
});
