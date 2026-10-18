import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: DurableObjectState, protected env: Env) {}
  },
}));

import { UserSession } from "../src/userSession.ts";

// Workers accept streamed request bodies directly; Node's fetch requires an extra option.
const NodeRequest = Request;
beforeEach(() => vi.stubGlobal("Request", class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, { ...init, ...(init?.body instanceof ReadableStream ? { duplex: "half" } : {}) });
  }
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const savedArchive = { key: "homes/person/saved.tar.gz", at: 1, bytes: 100 };

function fixture(options: { saved?: boolean; missing?: boolean; restoreStatus?: number; restored?: boolean; budgetFull?: boolean; archiveFails?: boolean; crashDuringSave?: boolean } = {}) {
  const events: string[] = [];
  const values = new Map<string, unknown>([
    ["uid", "person"],
    ["hostSecret", "current-host"],
    ["archives", options.saved === false ? [] : [savedArchive]],
    ["lastTickAt", Date.now() - 60_000],
    ...(options.restored ? [["restoredFor", "current-host"] as [string, unknown]] : []),
  ]);
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") values.set(key, value);
      else for (const [name, item] of Object.entries(key)) values.set(name, item);
    }),
    delete: vi.fn(async (key: string | string[]) => {
      for (const name of typeof key === "string" ? [key] : key) values.delete(name);
    }),
    setAlarm: vi.fn(async () => undefined),
  };
  const hostFetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/__adcode/health") return new Response("ok");
    if (path === "/__adcode/home-archive" && request.method === "PUT") return new Response(null, { status: options.restoreStatus ?? 204 });
    if (path === "/__adcode/home-archive" && request.method === "GET") {
      events.push("archive");
      if (options.crashDuringSave) container.running = false;
      return new Response("current home", { status: options.archiveFails ? 500 : 200 });
    }
    if (path === "/__adcode/state") return Response.json({ busy: true, lastInputAt: Date.now(), connections: 1 });
    return new Response("unexpected host request", { status: 500 });
  });
  const container = {
    running: true,
    setInactivityTimeout: vi.fn(async () => undefined),
    monitor: vi.fn(() => new Promise<void>(() => undefined)),
    destroy: vi.fn(async () => { events.push("destroy"); container.running = false; }),
    getTcpPort: vi.fn(() => ({ fetch: hostFetch })),
  };
  const bucket = {
    get: vi.fn(async () => options.missing ? null : { body: new Response("saved home").body }),
    createMultipartUpload: vi.fn(async () => ({
      uploadPart: vi.fn(async (partNumber: number) => ({ partNumber, etag: "part" })),
      complete: vi.fn(async () => { events.push("saved"); }),
      abort: vi.fn(),
    })),
    delete: vi.fn(),
  };
  const budget = {
    charge: vi.fn(async () => ({ full: options.budgetFull ?? false })),
    admit: vi.fn(async () => ({ ok: true })),
    release: vi.fn(async () => undefined),
  };
  const env = {
    HOMES: bucket,
    IDLE_SLEEP_MIN: "5",
    BUDGET: { getByName: () => budget },
  } as unknown as Env;
  const ctx = {
    storage,
    container,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (work: () => Promise<void>) => work()),
  } as unknown as DurableObjectState;
  const session = new UserSession(ctx, env);
  const lifecycle = session as unknown as { start(): Promise<void>; archive(): Promise<void>; tabs: Set<WebSocket> };
  const frames: { status?: { state: string; unlimited: boolean; message?: string } }[] = [];
  const tab = {
    send: vi.fn((text: string) => { frames.push(JSON.parse(text)); }),
    close: vi.fn(() => { events.push("closed"); }),
  };
  return { session, lifecycle, values, storage, container, bucket, hostFetch, budget, frames, tab, events };
}

describe("saved workspace restoration", () => {
  it("finishes restoring before scheduling snapshots and does not restore the same host twice", async () => {
    const { lifecycle, values, storage, bucket, hostFetch } = fixture();
    await lifecycle.start();
    expect(values.get("restoredFor")).toBe("current-host");
    expect(storage.setAlarm).toHaveBeenCalledOnce();
    const restore = hostFetch.mock.calls.find(([request]) => request.method === "PUT")?.[0];
    expect(await restore?.text()).toBe("saved home");
    await lifecycle.start();
    expect(bucket.get).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "missing archive", missing: true, message: "could not be found" },
    { name: "failed extraction", restoreStatus: 500, message: "failed (500)" },
  ])("keeps the saved home and stops the sandbox after $name", async ({ missing, restoreStatus, message }) => {
    const { lifecycle, values, storage, container, bucket } = fixture({ missing, restoreStatus });
    await expect(lifecycle.start()).rejects.toThrow(message);
    expect(values.has("restoredFor")).toBe(false);
    expect(values.get("archives")).toEqual([savedArchive]);
    expect(container.destroy).toHaveBeenCalledOnce();
    expect(storage.setAlarm).not.toHaveBeenCalled();
    expect(bucket.createMultipartUpload).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("does not snapshot a partial home even if stopping the failed sandbox fails", async () => {
    const { lifecycle, container, bucket, hostFetch, values } = fixture({ restoreStatus: 500 });
    container.destroy.mockRejectedValueOnce(new Error("stop unavailable"));
    await expect(lifecycle.start()).rejects.toThrow("Restoring");
    expect(container.running).toBe(true);
    hostFetch.mockClear();
    await expect(lifecycle.archive()).rejects.toThrow("has not finished restoring");
    expect(hostFetch).not.toHaveBeenCalled();
    expect(bucket.createMultipartUpload).not.toHaveBeenCalled();
    expect(values.get("archives")).toEqual([savedArchive]);
  });

  it("allows a new workspace with no previous archive to finish starting", async () => {
    const { lifecycle, values, bucket, storage } = fixture({ saved: false });
    await lifecycle.start();
    expect(values.get("restoredFor")).toBe("current-host");
    expect(bucket.get).not.toHaveBeenCalled();
    expect(storage.setAlarm).toHaveBeenCalledOnce();
  });

  it("keeps previews and project downloads unavailable while the saved home is restoring", async () => {
    const { session, hostFetch } = fixture();
    const status = await session.fetch(new Request("https://user.session/status"));
    expect(await status.json()).toMatchObject({ status: { state: "waking" } });
    const download = await session.fetch(new Request("https://user.session/download?project=app"));
    expect(download.status).toBe(503);
    const preview = await session.fetch(new Request("https://preview.example/", { headers: { "x-adcode-preview-port": "5173" } }));
    expect(preview.status).toBe(503);
    expect(hostFetch).not.toHaveBeenCalled();
  });
});

describe("monthly budget cutoff for active sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
  });

  it("archives a busy unlimited workspace before pausing it with full/code 4402", async () => {
    const { session, lifecycle, budget, storage, container, frames, tab, events } = fixture({ restored: true, budgetFull: true });
    lifecycle.tabs.add(tab as unknown as WebSocket);
    await session.alarm();
    expect(budget.charge).toHaveBeenCalledWith("person", 1);
    expect(events).toEqual(["archive", "saved", "closed", "destroy"]);
    expect(frames.at(-1)?.status).toMatchObject({ state: "full", unlimited: true });
    expect(tab.close).toHaveBeenCalledWith(4402, "full");
    expect(container.running).toBe(false);
    expect(storage.setAlarm).not.toHaveBeenCalled();
    const status = await session.fetch(new Request("https://user.session/status"));
    expect(await status.json()).toMatchObject({ status: { state: "full", resetsAt: Date.UTC(2026, 10, 1) } });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const nextMonth = await session.fetch(new Request("https://user.session/status"));
    expect(await nextMonth.json()).toMatchObject({ status: { state: "sleeping" } });
  });

  it("keeps unlimited runtime while the shared budget is available", async () => {
    const { session, lifecycle, container, storage, frames, tab, values } = fixture({ restored: true });
    values.set("usage", { usedMs: 24 * 60 * 60_000, windowStart: Date.now() - 60_000 });
    lifecycle.tabs.add(tab as unknown as WebSocket);
    await session.alarm();
    expect(container.destroy).not.toHaveBeenCalled();
    expect(tab.close).not.toHaveBeenCalled();
    expect(frames.at(-1)?.status).toMatchObject({ state: "ready", unlimited: true });
    expect(storage.setAlarm).toHaveBeenCalledWith(Date.now() + 60_000);
  });

  it("retains the prior archive and warns truthfully after two failed shutdown saves", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session, lifecycle, bucket, values, frames, tab, events } = fixture({ restored: true, budgetFull: true, archiveFails: true });
    lifecycle.tabs.add(tab as unknown as WebSocket);
    await session.alarm();
    expect(events).toEqual(["archive", "archive", "closed", "destroy"]);
    expect(values.get("archives")).toEqual([savedArchive]);
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(frames.at(-1)?.status).toMatchObject({ state: "full", message: expect.stringContaining("recent changes may be missing") });
    expect(tab.close).toHaveBeenCalledWith(4402, "full");
    const status = await session.fetch(new Request("https://user.session/status"));
    expect(await status.json()).toMatchObject({ status: { state: "full", message: expect.stringContaining("recent changes may be missing") } });
  });

  it("schedules another cutoff attempt if the platform cannot stop the container", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session, container, storage } = fixture({ restored: true, budgetFull: true });
    container.destroy.mockRejectedValueOnce(new Error("platform unavailable"));
    await session.alarm();
    expect(storage.setAlarm).toHaveBeenCalledWith(Date.now() + 60_000);
    const status = await session.fetch(new Request("https://user.session/status"));
    expect(await status.json()).toMatchObject({ status: { state: "full" } });
  });

  it("does not report a successful save when the container crashes between snapshot attempts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { session, lifecycle, frames, tab, events } = fixture({ restored: true, budgetFull: true, archiveFails: true, crashDuringSave: true });
    lifecycle.tabs.add(tab as unknown as WebSocket);
    await session.alarm();
    expect(events).toEqual(["archive", "closed", "destroy"]);
    expect(frames.at(-1)?.status).toMatchObject({ state: "full", message: expect.stringContaining("recent changes may be missing") });
  });

  it("keeps elapsed runtime pending when the global accounting request fails", async () => {
    const { session, budget, values } = fixture({ restored: true });
    const previousTick = values.get("lastTickAt");
    budget.charge.mockRejectedValueOnce(new Error("accounting unavailable"));
    await expect(session.alarm()).rejects.toThrow("accounting unavailable");
    expect(values.get("lastTickAt")).toBe(previousTick);
  });
});
