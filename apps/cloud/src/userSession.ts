/**
 * One per person: their sandbox, its allowance, its archives and its previews.
 *
 * The container is driven through the Durable Object Container API (`this.ctx.container`).
 * Each tab's WebSocket is bridged through here rather than passed straight through, for three
 * reasons: a bridged socket keeps the container running while a tab is open; the cloud can
 * speak on the same socket (time left, waking, asleep); and a few frames are answered here, not
 * by the sandbox (a fresh sign-in token is checked, a preview address is minted).
 *
 * The sandbox's disk does not survive sleep, and Cloudflare's own snapshots are tied to one
 * image version, so `/home/adcode` is archived to R2 as a tar.gz and restored on the next wake
 * into whatever image is current. See `docs/WEB-VERSION.md`.
 *
 * Close codes the tab understands (`apps/desktop/src/web/socket.ts`): 4401 signed out, 4408
 * asleep, 4429 no time left in this session window, 4402 the month is full, 4503 every sandbox is busy.
 */
import { DurableObject } from "cloudflare:workers";
import { addUsage, nextReset, shouldSleep, usedMs, type Usage } from "./allowance.ts";
import { verifyIdToken } from "./auth.ts";
import { monthKey } from "./budget.ts";
import { numberVar, type Env } from "./env.ts";
import { HOST_PORT as PREVIEW_RESERVED_PORT, newPreviewId, rewriteLoopbackUrl } from "./previewAuth.ts";
import { putStream } from "./r2Archive.ts";

// adcode-host listens here inside the sandbox (also refused as a preview port by previewAuth).
const HOST_PORT = PREVIEW_RESERVED_PORT;
const TICK_MS = 60_000;
const HEALTH_TIMEOUT_MS = 90_000;
const KEEP_ARCHIVES = 3;
const STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const MINUTE = 60_000;

type CloudState = "waking" | "ready" | "sleeping" | "spent" | "full" | "busy" | "restarted";

interface ArchiveRecord {
  readonly key: string;
  readonly at: number;
  readonly bytes: number;
}

interface HostState {
  readonly busy: boolean;
  readonly lastInputAt: number;
  readonly connections: number;
}

function randomBase64(bytes: number): string {
  let binary = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(bytes))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeSend(socket: WebSocket, text: string): void {
  try {
    socket.send(text);
  } catch {
    // the tab has gone
  }
}

export class UserSession extends DurableObject<Env> {
  /** The browser ends of the bridges, one per connected tab. */
  private readonly tabs = new Set<WebSocket>();
  private starting: Promise<void> | null = null;
  private restarted = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running === true) {
      void ctx.blockConcurrencyWhile(async () => {
        await container.setInactivityTimeout(this.idleMs() + 2 * MINUTE).catch(() => undefined);
      });
      this.watch();
    }
  }

  /* ── Settings ─────────────────────────────────────────────────────────── */

  private windowMs(): number {
    return numberVar(this.env.SESSION_HOURS, 5) * 60 * MINUTE;
  }

  private idleMs(): number {
    return numberVar(this.env.IDLE_SLEEP_MIN, 5) * MINUTE;
  }

  private untouchedMs(): number {
    return numberVar(this.env.UNTOUCHED_TAB_MIN, 15) * MINUTE;
  }

  private snapshotEveryMs(): number {
    return numberVar(this.env.SNAPSHOT_EVERY_MIN, 10) * MINUTE;
  }

  /* ── Stored state ─────────────────────────────────────────────────────── */

  private async uid(): Promise<string> {
    return (await this.ctx.storage.get<string>("uid")) ?? "";
  }

  private async usage(): Promise<Usage> {
    return (await this.ctx.storage.get<Usage>("usage")) ?? { usedMs: 0 };
  }

  private async archives(): Promise<ArchiveRecord[]> {
    return (await this.ctx.storage.get<ArchiveRecord[]>("archives")) ?? [];
  }

  private async homeRestored(): Promise<boolean> {
    const secret = await this.ctx.storage.get<string>("hostSecret");
    return secret !== undefined && (await this.ctx.storage.get<string>("restoredFor")) === secret;
  }

  private async sealKey(): Promise<string> {
    let key = await this.ctx.storage.get<string>("sealKey");
    if (key === undefined) {
      key = randomBase64(32);
      await this.ctx.storage.put("sealKey", key);
    }
    return key;
  }

  private async previewId(): Promise<string> {
    let id = await this.ctx.storage.get<string>("previewId");
    if (id === undefined) {
      id = newPreviewId();
      await this.ctx.storage.put("previewId", id);
      await this.env.PREVIEW.getByName(id).set(await this.uid());
    }
    return id;
  }

  private async status(state: CloudState, message?: string): Promise<string> {
    const now = Date.now();
    const usage = await this.usage();
    const archives = await this.archives();
    const statusMessage = message ?? (state === "full" || state === "sleeping" ? await this.ctx.storage.get<string>("pauseMessage") : undefined);
    const running = (await this.ctx.storage.get<number>("runningSince")) ?? null;
    const unaccounted = running === null ? 0 : now - ((await this.ctx.storage.get<number>("lastTickAt")) ?? running);
    return JSON.stringify({
      t: "cloud",
      status: {
        state,
        allowanceMs: 0,
        unlimited: true,
        usedMs: usedMs(usage, now, this.windowMs()) + unaccounted,
        resetsAt: state === "full" ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1) : nextReset(usage, now, this.windowMs()),
        storageBytes: archives.at(-1)?.bytes ?? 0,
        ...(statusMessage === undefined ? {} : { message: statusMessage }),
      },
    });
  }

  private async broadcast(state: CloudState, message?: string): Promise<void> {
    const text = await this.status(state, message);
    for (const tab of this.tabs) safeSend(tab, text);
  }

  /* ── Requests from the Worker ─────────────────────────────────────────── */

  async fetch(request: Request): Promise<Response> {
    // Previews keep their own path, so they are recognised by the header the Worker adds.
    if (request.headers.has("x-adcode-preview-port")) return this.preview(request);
    const url = new URL(request.url);
    const uid = request.headers.get("x-adcode-uid");
    if (uid !== null && uid.length > 0 && (await this.ctx.storage.get<string>("uid")) === undefined) {
      await this.ctx.storage.put("uid", uid);
    }

    switch (url.pathname) {
      case "/socket":
        return this.openTab();
      case "/status": {
        let state: CloudState = "sleeping";
        if ((await this.ctx.storage.get<string>("budgetFullMonth")) === monthKey(Date.now())) state = "full";
        else if (this.ctx.container?.running === true) state = await this.homeRestored() ? "ready" : "waking";
        return new Response(await this.status(state), { headers: { "content-type": "application/json" } });
      }
      case "/download":
        return this.download(url.searchParams.get("project") ?? "");
      case "/delete":
        return this.deleteEverything();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /* ── The tab's socket ─────────────────────────────────────────────────── */

  private refuse(code: number, text: string): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    safeSend(server, text);
    server.close(code, "Paused");
    return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "adcode.v1" } });
  }

  private async openTab(): Promise<Response> {
    const uid = await this.uid();

    const running = this.ctx.container?.running === true;
    const admitted = await this.env.BUDGET.getByName("global").admit(uid);
    if (!admitted.ok) {
      if (admitted.reason === "full") await this.ctx.storage.put("budgetFullMonth", monthKey(Date.now()));
      return admitted.reason === "full"
        ? this.refuse(4402, await this.status("full"))
        : this.refuse(4503, await this.status("busy"));
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    this.tabs.add(server);
    await this.ctx.storage.delete("idleSince");
    safeSend(server, await this.status(running && await this.homeRestored() ? "ready" : "waking"));
    this.ctx.waitUntil(this.attach(server));
    return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "adcode.v1" } });
  }

  /** Connects one tab to adcode-host, relaying both ways and answering the cloud's own frames. */
  private async attach(tab: WebSocket): Promise<void> {
    const queued: string[] = [];
    let upstream: WebSocket | null = null;

    tab.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      void this.fromTab(tab, text).then((forward) => {
        if (forward === null) return;
        if (upstream === null) queued.push(forward);
        else safeSend(upstream, forward);
      });
    });
    tab.addEventListener("close", () => {
      this.tabs.delete(tab);
      try {
        upstream?.close(1000, "Tab closed");
      } catch {
        // already closed
      }
      if (this.tabs.size === 0) void this.ctx.storage.put("idleSince", Date.now());
    });

    try {
      await this.ensureRunning();
      const secret = (await this.ctx.storage.get<string>("hostSecret")) ?? "";
      const response = await this.ctx.container!.getTcpPort(HOST_PORT).fetch(
        new Request("http://container/socket", {
          headers: { upgrade: "websocket", "x-adcode-host-secret": secret, "sec-websocket-protocol": "adcode.v1" },
        }),
      );
      const socket = response.webSocket;
      if (socket === null) throw new Error(`The sandbox refused the connection (${response.status})`);
      socket.accept();
      upstream = socket;
      socket.addEventListener("message", (event) => safeSend(tab, typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)));
      socket.addEventListener("close", () => {
        try {
          tab.close(1011, "The sandbox closed the connection");
        } catch {
          // already closed
        }
      });
      for (const text of queued.splice(0)) safeSend(socket, text);
      safeSend(tab, await this.status(this.restarted ? "restarted" : "ready"));
      this.restarted = false;
    } catch (error) {
      console.error("[adcode-cloud] could not attach a tab", error);
      safeSend(tab, await this.status("waking", "ADCode couldn't start your workspace. Reload to try again."));
      try {
        tab.close(1011, "Could not start");
      } catch {
        // already closed
      }
    }
  }

  /** Frames the cloud answers itself; everything else goes to the sandbox unchanged. */
  private async fromTab(tab: WebSocket, text: string): Promise<string | null> {
    let frame: { t?: unknown; id?: unknown; url?: unknown; token?: unknown };
    try {
      frame = JSON.parse(text) as typeof frame;
    } catch {
      return null;
    }
    if (frame.t === "input") {
      await this.ctx.storage.put("lastInputAt", Date.now());
      return text;
    }
    if (frame.t === "auth") {
      // A fresh token for the same person goes on to the sandbox; anything else is dropped.
      if (typeof frame.token !== "string") return null;
      const verified = await verifyIdToken(frame.token, this.env.FIREBASE_PROJECT_ID).catch(() => null);
      const devToken = this.env.ALLOW_DEV_TOKEN === "1" && frame.token === "dev";
      return devToken || verified?.uid === (await this.uid()) ? text : null;
    }
    if (frame.t === "previewUrl" && typeof frame.id === "number" && typeof frame.url === "string") {
      safeSend(tab, JSON.stringify({ t: "previewUrl", id: frame.id, url: await this.previewAddress(frame.url) }));
      return null;
    }
    return text;
  }

  /** A sandbox-local address as the preview address the person's browser can open, with a one-time sign-in. */
  private async previewAddress(local: string): Promise<string> {
    const id = await this.previewId();
    const rewritten = rewriteLoopbackUrl(local, id, this.env.PREVIEW_SUFFIX);
    if (rewritten === null) return local;
    const target = new URL(rewritten);
    const nonce = await this.env.PREVIEW.getByName(id).mint();
    return `${target.origin}/__adcode/auth?t=${nonce}&next=${encodeURIComponent(`${target.pathname}${target.search}${target.hash}`)}`;
  }

  /* ── The container ────────────────────────────────────────────────────── */

  private ensureRunning(): Promise<void> {
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const container = this.ctx.container;
    if (container === undefined) throw new Error("No container is configured for UserSession");
    if (!container.running) {
      const secret = randomBase64(24);
      await this.ctx.storage.put("hostSecret", secret);
      await this.ctx.storage.delete("restoredFor");
      container.start({
        image: container.images["adcode"]!,
        instance: (this.env.INSTANCE_TYPE || "standard-1") as "standard-1",
        enableInternet: true,
        env: {
          ADCODE_HOST_SECRET: secret,
          ADCODE_SEAL_KEY: await this.sealKey(),
          ADCODE_HOME: "/home/adcode",
          ADCODE_HOST_BIND: "0.0.0.0",
          ADCODE_HOST_PORT: String(HOST_PORT),
          ADCODE_PLATFORM: "web",
          ...(this.env.ADCODE_API_BASE ? { ADCODE_AD_SERVER: this.env.ADCODE_API_BASE } : {}),
        },
        labels: { app: "adcode-web" },
      });
      const now = Date.now();
      await this.ctx.storage.put({ runningSince: now, lastTickAt: now, lastArchiveAt: now });
      this.watch();
    }
    await container.setInactivityTimeout(this.idleMs() + 2 * MINUTE).catch(() => undefined);
    await this.waitForHost();
    try {
      await this.restoreOnce();
    } catch (error) {
      // Never expose or later archive an empty/partly restored home. The saved copy stays
      // authoritative, and a fresh container retries it when the person reconnects.
      await container.destroy().catch(() => undefined);
      throw error;
    }
    await this.ctx.storage.delete(["budgetFullMonth", "pauseMessage"]);
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private watch(): void {
    this.ctx.waitUntil(
      this.ctx.container!.monitor().then(
        () => this.onStopped(false),
        () => this.onStopped(true),
      ),
    );
  }

  private async onStopped(crashed: boolean): Promise<void> {
    const wasRunning = (await this.ctx.storage.get<number>("runningSince")) !== undefined;
    await this.accountTime(Date.now());
    await this.ctx.storage.delete(["runningSince", "lastTickAt", "hostSecret", "restoredFor"]);
    await this.env.BUDGET.getByName("global").release(await this.uid());
    if (crashed && wasRunning && this.tabs.size > 0) {
      this.restarted = true;
      for (const tab of this.tabs) {
        try {
          tab.close(1012, "Restarting");
        } catch {
          // already closed
        }
      }
    }
  }

  private async host(path: string, init?: RequestInit): Promise<Response> {
    const secret = (await this.ctx.storage.get<string>("hostSecret")) ?? "";
    const headers = new Headers(init?.headers);
    headers.set("x-adcode-host-secret", secret);
    return this.ctx.container!.getTcpPort(HOST_PORT).fetch(new Request(`http://container${path}`, { ...init, headers }));
  }

  private async waitForHost(): Promise<void> {
    const until = Date.now() + HEALTH_TIMEOUT_MS;
    for (;;) {
      try {
        const response = await this.ctx.container!.getTcpPort(HOST_PORT).fetch(new Request("http://container/__adcode/health"));
        if (response.ok) return;
      } catch {
        // still starting
      }
      if (Date.now() > until) throw new Error("The sandbox did not start in time");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /** The newest archive goes back into a freshly started container, once per start. */
  private async restoreOnce(): Promise<void> {
    const secret = await this.ctx.storage.get<string>("hostSecret");
    if (secret === undefined) throw new Error("The workspace has no active host");
    if ((await this.ctx.storage.get<string>("restoredFor")) === secret) return;
    const newest = (await this.archives()).at(-1);
    if (newest !== undefined) {
      const object = await this.env.HOMES.get(newest.key);
      if (object === null) throw new Error("The saved workspace could not be found");
      const response = await this.host("/__adcode/home-archive", { method: "PUT", body: object.body });
      if (!response.ok) throw new Error(`Restoring the saved workspace failed (${response.status})`);
    }
    await this.ctx.storage.put("restoredFor", secret);
  }

  private async archive(): Promise<void> {
    if (this.ctx.container?.running !== true) throw new Error("The workspace stopped before it could be saved");
    if (!(await this.homeRestored())) throw new Error("The workspace has not finished restoring; keeping the saved copy");
    const uid = await this.uid();
    const response = await this.host("/__adcode/home-archive");
    if (!response.ok || response.body === null) throw new Error(`Archive failed (${response.status})`);
    const key = `homes/${uid}/${Date.now()}.tar.gz`;
    const bytes = await putStream(this.env.HOMES, key, response.body);
    const records = [...(await this.archives()), { key, at: Date.now(), bytes }];
    const kept = records.slice(-KEEP_ARCHIVES);
    for (const old of records.slice(0, -KEEP_ARCHIVES)) await this.env.HOMES.delete(old.key).catch(() => undefined);
    await this.ctx.storage.put({ archives: kept, lastArchiveAt: Date.now() });
    if (bytes > STORAGE_LIMIT_BYTES) await this.broadcast("ready", "Your cloud workspace is over 2 GB. Delete a project or its node_modules to keep it fast.");
  }

  private async archiveSafely(notifyFailure = true): Promise<boolean> {
    try {
      await this.archive();
      return true;
    } catch (first) {
      console.error("[adcode-cloud] archive failed, retrying", first);
      try {
        await this.archive();
        return true;
      } catch (second) {
        console.error("[adcode-cloud] archive failed twice", second);
        if (notifyFailure) await this.broadcast("ready", "Saving your workspace failed. Download your project to keep a copy.");
        return false;
      }
    }
  }

  private async accountTime(now: number): Promise<boolean> {
    const lastTick = await this.ctx.storage.get<number>("lastTickAt");
    if (lastTick === undefined) return false;
    const delta = Math.max(0, now - lastTick);
    const full = (await this.env.BUDGET.getByName("global").charge(await this.uid(), delta / MINUTE)).full;
    await this.ctx.storage.put({ usage: addUsage(await this.usage(), now, delta, this.windowMs()), lastTickAt: now });
    return full;
  }

  private async sleep(state: "sleeping" | "spent" | "full", code: number): Promise<void> {
    if (state === "full") await this.ctx.storage.put("budgetFullMonth", monthKey(Date.now()));
    const saved = await this.archiveSafely(false);
    const message = saved ? undefined : `Your workspace is paused. Saving your latest changes failed after two attempts. ${(await this.archives()).length > 0 ? "Your previous saved copy is kept; recent changes may be missing." : "No saved copy is available; recent changes may be lost."}`;
    if (message === undefined) await this.ctx.storage.delete("pauseMessage");
    else await this.ctx.storage.put("pauseMessage", message);
    await this.broadcast(state, message);
    for (const tab of this.tabs) {
      try {
        tab.close(code, state);
      } catch {
        // already closed
      }
    }
    this.tabs.clear();
    try {
      await this.ctx.container?.destroy();
    } catch (error) {
      console.error("[adcode-cloud] could not stop the workspace; retrying next minute", error);
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async alarm(): Promise<void> {
    const container = this.ctx.container;
    if (container?.running !== true) {
      await this.onStopped(false);
      return;
    }
    const now = Date.now();
    if (await this.accountTime(now)) {
      // The global budget also applies to existing sessions, including a busy agent. Save
      // before stopping; personal runtime remains unlimited while the shared budget lasts.
      await this.sleep("full", 4402);
      return;
    }

    let hostState: HostState = { busy: false, lastInputAt: now, connections: this.tabs.size };
    try {
      hostState = (await (await this.host("/__adcode/state")).json()) as HostState;
    } catch {
      // the host is busy or restarting; judge by the tabs alone this minute
    }
    const lastInputAt = Math.max(hostState.lastInputAt, (await this.ctx.storage.get<number>("lastInputAt")) ?? 0);
    const idleSince = this.tabs.size === 0 ? ((await this.ctx.storage.get<number>("idleSince")) ?? now) : null;
    if (shouldSleep({ connections: this.tabs.size, busy: hostState.busy, lastInputAt, idleSince }, now, { idleMs: this.idleMs(), untouchedMs: this.untouchedMs() })) {
      await this.sleep("sleeping", 4408);
      return;
    } else if (now - ((await this.ctx.storage.get<number>("lastArchiveAt")) ?? now) >= this.snapshotEveryMs()) {
      this.ctx.waitUntil(this.archiveSafely());
    }

    await this.broadcast("ready");
    await this.ctx.storage.setAlarm(now + TICK_MS);
  }

  /* ── Downloads, deletion, previews ────────────────────────────────────── */

  private async download(project: string): Promise<Response> {
    if (this.ctx.container?.running !== true) return new Response(JSON.stringify({ ok: false, error: "Open ADCode first to wake your workspace" }), { status: 409 });
    if (!(await this.homeRestored())) return new Response(JSON.stringify({ ok: false, error: "Your saved workspace is still restoring. Try again shortly." }), { status: 503 });
    const response = await this.host(`/__adcode/download?project=${encodeURIComponent(project)}`);
    return new Response(response.body, { status: response.status, headers: response.headers });
  }

  private async deleteEverything(): Promise<Response> {
    for (const tab of this.tabs) {
      try {
        tab.close(4401, "Deleted");
      } catch {
        // already closed
      }
    }
    this.tabs.clear();
    // Time already used in this window is spent whatever happens to the files: deleting the
    // workspace must not hand back a fresh allowance.
    await this.accountTime(Date.now());
    const usage = await this.usage();
    await this.ctx.container?.destroy().catch(() => undefined);
    const uid = await this.uid();
    let cursor: string | undefined;
    do {
      const listed = await this.env.HOMES.list({ prefix: `homes/${uid}/`, ...(cursor === undefined ? {} : { cursor }) });
      if (listed.objects.length > 0) await this.env.HOMES.delete(listed.objects.map((object) => object.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
    await this.env.BUDGET.getByName("global").release(uid);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put({ uid, usage });
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  private async preview(request: Request): Promise<Response> {
    const port = Number(request.headers.get("x-adcode-preview-port"));
    if (this.ctx.container?.running !== true) {
      return new Response("<!doctype html><title>Asleep</title><p style=\"font:16px system-ui;padding:24px\">This workspace is asleep. Open ADCode to wake it.</p>", {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }
    if (!(await this.homeRestored())) return new Response("Your saved workspace is still restoring. Try again shortly.", { status: 503, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("host", `localhost:${port}`);
    for (const name of ["x-adcode-preview-port", "x-adcode-uid", "x-adcode-email", "cookie"]) headers.delete(name);
    const upstream = await this.ctx.container.getTcpPort(port).fetch(
      new Request(`http://localhost:${port}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
        redirect: "manual",
      }),
    );
    if (upstream.webSocket !== null) {
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      const inner = upstream.webSocket;
      inner.accept();
      server.accept();
      inner.addEventListener("message", (event) => safeSend(server, event.data as string));
      server.addEventListener("message", (event) => safeSend(inner, event.data as string));
      inner.addEventListener("close", () => server.close(1000));
      server.addEventListener("close", () => inner.close(1000));
      return new Response(null, { status: 101, webSocket: client });
    }
    const out = new Headers(upstream.headers);
    out.set("x-robots-tag", "noindex, nofollow");
    out.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  }
}
