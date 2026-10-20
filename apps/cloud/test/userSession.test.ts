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

function fixture(options: { saved?: boolean; missing?: boolean; restoreStatus?: number; restored?: boolean; budgetFull?: boolean; archiveFails?: boolean; crashDuringSave?: boolean; running?: boolean; busy?: boolean; monitorStops?: boolean } = {}) {
  const events: string[] = [];
  const values = new Map<string, unknown>([
    ["uid", "person"],
    ["hostSecret", "current-host"],
    ["archives", options.saved === false ? [] : [savedArchive]],
    ["lastTickAt", Date.now() - 60_000],
    ...(options.running === false ? [] : [["runningSince", Date.now() - 60_000] as [string, unknown]]),
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
    if (path === "/__adcode/state") return Response.json({ busy: options.busy ?? true, lastInputAt: Date.now(), connections: 1 });
    return new Response("unexpected host request", { status: 500 });
  });
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
  const container = {
    running: options.running ?? true,
    images: { adcode: "adcode-image" },
    start: vi.fn(() => { container.running = true; }),
    setInactivityTimeout: vi.fn(async () => undefined),
    monitor: vi.fn(() => stopped),
    destroy: vi.fn(async () => {
      events.push("destroy");
      container.running = false;
      if (options.monitorStops) resolveStopped();
    }),
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
    charge: vi.fn(async (): Promise<{ full: boolean } | void> => ({ full: options.budgetFull ?? false })),
    admit: vi.fn(async (): Promise<{ ok: true } | { ok: false; reason: "full" | "busy" }> => ({ ok: true })),
    release: vi.fn(async () => undefined),
  };
  const env = {
    HOMES: bucket,
    IDLE_SLEEP_MIN: "5",
    BUDGET: { getByName: () => budget },
  } as unknown as Env;
  const waitUntil = vi.fn((_promise: Promise<unknown>) => undefined);
  const ctx = {
    storage,
    container,
    waitUntil,
    blockConcurrencyWhile: vi.fn(async (work: () => Promise<void>) => work()),
  } as unknown as DurableObjectState;
  const session = new UserSession(ctx, env);
  const lifecycle = session as unknown as { start(): Promise<void>; attach(tab: WebSocket): Promise<void>; archive(): Promise<void>; tabs: Set<WebSocket> };
  const frames: { status?: { state: string; unlimited: boolean; message?: string } }[] = [];
  const tab = {
    addEventListener: vi.fn(),
    send: vi.fn((text: string) => { frames.push(JSON.parse(text)); }),
    close: vi.fn(() => { events.push("closed"); }),
  };
  return { session, lifecycle, values, storage, container, bucket, hostFetch, budget, frames, tab, events, ctx, env, waitUntil };
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

describe("sandbox capacity cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("saves and stops an abandoned sandbox after an object reset without tab close events", async () => {
    const { session, values, container, storage, events, ctx, env } = fixture({ restored: true, busy: false });
    const firstIdleAt = Date.now();
    await session.alarm();
    expect(values.get("idleSince")).toBe(firstIdleAt);
    expect(container.destroy).not.toHaveBeenCalled();

    vi.setSystemTime(firstIdleAt + 4 * 60_000);
    const recreated = new UserSession(ctx, env);
    await recreated.alarm();
    expect(values.get("idleSince")).toBe(firstIdleAt);
    expect(container.destroy).not.toHaveBeenCalled();

    storage.setAlarm.mockClear();
    vi.setSystemTime(firstIdleAt + 5 * 60_000);
    await recreated.alarm();
    expect(events).toEqual(["archive", "saved", "destroy"]);
    expect(container.running).toBe(false);
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("keeps an agent running without tabs and sleeps after its work finishes", async () => {
    const { session, values, container, hostFetch } = fixture({ restored: true });
    const firstIdleAt = Date.now();
    await session.alarm();
    vi.setSystemTime(firstIdleAt + 6 * 60_000);
    await session.alarm();
    expect(values.get("idleSince")).toBe(firstIdleAt);
    expect(container.destroy).not.toHaveBeenCalled();

    hostFetch.mockResolvedValueOnce(Response.json({ busy: false, lastInputAt: firstIdleAt, connections: 0 }));
    await session.alarm();
    expect(container.destroy).toHaveBeenCalledOnce();
  });

  it("stops a sandbox that never becomes healthy without overwriting its saved home", async () => {
    const { lifecycle, container, hostFetch, values, bucket, storage, budget, waitUntil } = fixture({ monitorStops: true });
    hostFetch.mockImplementation(async () => new Response("starting", { status: 503 }));
    const failedStart = expect(lifecycle.start()).rejects.toThrow("did not start in time");
    await vi.advanceTimersByTimeAsync(91_000);
    await failedStart;
    await waitUntil.mock.calls[0]?.[0];
    expect(container.destroy).toHaveBeenCalledOnce();
    expect(values.get("archives")).toEqual([savedArchive]);
    expect(bucket.createMultipartUpload).not.toHaveBeenCalled();
    expect(storage.setAlarm).not.toHaveBeenCalled();
    expect(budget.release).toHaveBeenCalledExactlyOnceWith("person");
  });

  it("retries stopped-container bookkeeping after an accounting outage so admission is returned", async () => {
    const { session, values, container, budget, storage, waitUntil } = fixture({ monitorStops: true });
    const previousTick = values.get("lastTickAt");
    budget.charge.mockRejectedValueOnce(new Error("accounting unavailable"));
    const failedStop = expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow("accounting unavailable");
    await container.destroy();
    await failedStop;
    expect(values.get("lastTickAt")).toBe(previousTick);
    expect(budget.release).not.toHaveBeenCalled();
    expect(storage.setAlarm).toHaveBeenCalledWith(Date.now() + 60_000);

    await session.alarm();
    expect(budget.release).toHaveBeenCalledExactlyOnceWith("person");
    expect(values.has("runningSince")).toBe(false);
  });

  it("schedules idle cleanup when a failed startup cannot be stopped", async () => {
    const { lifecycle, container, storage, values } = fixture({ restoreStatus: 500 });
    container.destroy.mockRejectedValueOnce(new Error("stop unavailable"));
    await expect(lifecycle.start()).rejects.toThrow("Restoring");
    expect(container.running).toBe(true);
    expect(values.has("restoredFor")).toBe(false);
    expect(storage.setAlarm).toHaveBeenCalledWith(Date.now() + 60_000);
  });

  it("returns admission when launching the container fails before monitoring starts", async () => {
    const { lifecycle, container, budget, tab, storage } = fixture({ running: false });
    container.start.mockImplementationOnce(() => { throw new Error("launch unavailable"); });
    await lifecycle.attach(tab as unknown as WebSocket);
    expect(budget.release).toHaveBeenCalledExactlyOnceWith("person");
    expect(tab.close).toHaveBeenCalledWith(1011, "Could not start");
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("keeps an existing sandbox's admission when a tab fails to attach", async () => {
    const { lifecycle, container, budget, tab } = fixture({ restored: true });
    await lifecycle.attach(tab as unknown as WebSocket);
    expect(container.running).toBe(true);
    expect(container.destroy).not.toHaveBeenCalled();
    expect(budget.release).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalledWith(1011, "Could not start");
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

  it("pauses at the exact cap when an older budget RPC returns no result", async () => {
    const { session, lifecycle, budget, frames, tab } = fixture({ restored: true });
    budget.charge.mockResolvedValueOnce(undefined);
    budget.admit.mockResolvedValueOnce({ ok: false, reason: "full" });
    lifecycle.tabs.add(tab as unknown as WebSocket);
    await session.alarm();
    expect(budget.admit).toHaveBeenCalledWith("person");
    expect(frames.at(-1)?.status).toMatchObject({ state: "full" });
    expect(tab.close).toHaveBeenCalledWith(4402, "full");
  });

  it("does not re-charge a recorded interval if the legacy admission fallback fails", async () => {
    const { session, budget, values } = fixture({ restored: true });
    budget.charge.mockResolvedValueOnce(undefined);
    budget.admit.mockRejectedValueOnce(new Error("admission unavailable"));
    await expect(session.alarm()).rejects.toThrow("admission unavailable");
    expect(values.get("lastTickAt")).toBe(Date.now());
    await session.alarm();
    expect(budget.charge.mock.calls).toEqual([["person", 1], ["person", 0]]);
  });
});
