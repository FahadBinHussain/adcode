import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAdStore, createBrowserAdTokens, createBrowserAdTransport, mountBrowserAds } from "../src/web/browserAds.ts";
import type { WebSession } from "../src/web/gate.ts";
import type { HttpRequest, Receipt } from "@adcode/ads";

const token = (uid: string): string => `header.${btoa(JSON.stringify({ sub: uid }))}.signature`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const session = (uid = "person"): WebSession => ({ uid, token: token(uid), email: null, refresh: vi.fn(async () => token(uid)), signOut: vi.fn(async () => undefined) });
const request = (url = "https://adcode.bluethenics.com/v1/config", method: "GET" | "POST" = "GET"): HttpRequest => ({ method, url, headers: {}, timeoutMs: 3000 });
const receipt = (id = "receipt-1"): Receipt => ({ receiptId: id, creativeId: "creative-1", shownAt: 1000, dwellMs: 8000, themeKind: "dark", outcome: "impression" });
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("browser ad identity and network boundary", () => {
  it("does nothing without a stable user identity or in local development", () => {
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    const { uid: _uid, ...withoutIdentity } = session();
    expect(() => mountBrowserAds(withoutIdentity).dispose()).not.toThrow();
    expect(() => mountBrowserAds({ ...session(), token: "dev" }).dispose()).not.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns auth failures for a refresh error, signed-out account or switched identity", async () => {
    const signedIn = session();
    for (const refresh of [async () => null, async () => token("different"), async () => { throw new Error("offline"); }]) {
      expect(await createBrowserAdTokens({ ...signedIn, refresh }).getToken()).toMatchObject({ ok: false, error: { kind: "auth" } });
    }
    const tokens = createBrowserAdTokens(signedIn); tokens.invalidate(); expect((await tokens.getToken()).ok).toBe(true);
    expect(signedIn.refresh).toHaveBeenCalledWith(true);
  });

  it("rewrites only known API and artwork routes and authenticates every fetch", async () => {
    const signedIn = session();
    const fetchImpl = vi.fn<typeof fetch>(async input => String(input).startsWith("/api/ad-assets/") ? new Response(PNG) : Response.json({ ok: true }));
    const transport = createBrowserAdTransport(signedIn, { fetchImpl });
    await transport.request(request());
    await transport.request(request("https://adcode.bluethenics.com/assets/creative-1-dark.png"));
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["/v1/config", "/api/ad-assets/creative-1-dark.png"]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token("person")}`);
      expect(new Headers(init?.headers).get("x-adcode-platform")).toBe("web");
      expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
    }
    expect(signedIn.refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://adcode.bluethenics.com/assets/logo.png", "https://evil.test/assets/logo.png", "https://adcode.bluethenics.com.evil.test/assets/logo.png",
    "https://person:secret@adcode.bluethenics.com/assets/logo.png", "https://adcode.bluethenics.com:444/assets/logo.png",
    "https://adcode.bluethenics.com/assets/nested/logo.png", "https://adcode.bluethenics.com/assets/active.svg",
    "https://adcode.bluethenics.com/v1/admin/tagflow", "https://adcode.bluethenics.com/v1/config?token=secret",
  ])("rejects an unapproved destination before fetching: %s", async url => {
    const fetchImpl = vi.fn(); const transport = createBrowserAdTransport(session(), { fetchImpl });
    await expect(transport.request(request(url))).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects, active artwork and oversized streaming bodies", async () => {
    const asset = request("https://adcode.bluethenics.com/assets/creative-1-dark.png");
    const responses = [new Response(null, { status: 302, headers: { location: "https://evil.test" } }), new Response("<svg onload=alert(1)></svg>"), new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); controller.close(); } }))];
    for (const response of responses) await expect(createBrowserAdTransport(session(), { fetchImpl: async () => response }).request(asset)).rejects.toThrow();
  });

  it("stops requests when disposed and imposes a short request timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }));
    const transport = createBrowserAdTransport(session(), { fetchImpl });
    const pending = transport.request(request()); const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3001); await assertion;
    const disposed = new AbortController(); disposed.abort();
    await expect(createBrowserAdTransport(session(), { fetchImpl, signal: disposed.signal }).request(request())).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("browser receipt and asset storage", () => {
  it("keeps receipts separate between accounts and never persists assets or extra fields", async () => {
    const storage = memoryStorage(); const first = createBrowserAdStore("person", storage); const second = createBrowserAdStore("another", storage);
    await first.write("ads/receipts.json", new TextEncoder().encode(JSON.stringify([{ ...receipt(), token: "must-not-be-stored", prompt: "private text" }])));
    await first.write("ads/assets/a", PNG);
    expect(await second.read("ads/receipts.json")).toBeNull();
    expect(storage.values.size).toBe(1);
    expect(JSON.parse(new TextDecoder().decode((await first.read("ads/receipts.json"))!))).toEqual([receipt()]);
    expect([...storage.values.values()].join("")).not.toMatch(/must-not-be-stored|private text|token|prompt/);
    first.clear(); expect(await first.read("ads/assets/a")).toBeNull();
    expect(await first.read("ads/receipts.json")).not.toBeNull();
  });

  it("bounds total artwork memory, using recent reads to choose what to evict", async () => {
    const store = createBrowserAdStore("person", memoryStorage());
    await store.write("ads/assets/a", new Uint8Array(800_000)); await store.write("ads/assets/b", new Uint8Array(800_000));
    await store.read("ads/assets/a"); await store.write("ads/assets/c", new Uint8Array(800_000));
    expect(await store.read("ads/assets/b")).toBeNull(); expect((await store.read("ads/assets/a"))?.byteLength).toBe(800_000);
    expect((await store.read("ads/assets/c"))?.byteLength).toBe(800_000);
    await store.write("ads/assets/huge", new Uint8Array(2_000_001)); expect(await store.read("ads/assets/huge")).toBeNull();
  });

  it("bounds and validates queued receipts even when browser storage was edited", async () => {
    const storage = memoryStorage(); const store = createBrowserAdStore("person", storage);
    await store.write("ads/receipts.json", new TextEncoder().encode(JSON.stringify(Array.from({ length: 600 }, (_, index) => receipt(`r-${index}`)))));
    const saved = JSON.parse(new TextDecoder().decode((await store.read("ads/receipts.json"))!)); expect(saved).toHaveLength(500); expect(saved[0].receiptId).toBe("r-100");
    await store.write("ads/receipts.json", new TextEncoder().encode("{")); expect(new TextDecoder().decode((await store.read("ads/receipts.json"))!)).toBe("[]");
    const unavailable = createBrowserAdStore("person", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
    await unavailable.write("ads/receipts.json", new TextEncoder().encode(JSON.stringify([receipt()])));
    expect(await unavailable.read("ads/receipts.json")).not.toBeNull();
  });
});

/** A small event-capable DOM port; the real scheduler, renderer and receipt queue run below. */
class ElementPort extends EventTarget {
  className = ""; textContent = ""; hidden = false; disabled = false; type = ""; alt = ""; src = "";
  dataset: Record<string, string> = {}; children: ElementPort[] = []; parent: ElementPort | null = null; root = false;
  get isConnected(): boolean { return this.root || this.parent?.isConnected === true; }
  setAttribute(_name: string, _value: string): void {}
  append(...nodes: ElementPort[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove(): void { if (this.parent !== null) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  contains(node: ElementPort): boolean { return node === this || this.children.some(child => child.contains(node)); }
  getClientRects(): unknown[] { return this.isConnected && !this.hidden ? [{}] : []; }
}
function domFixture() {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const body = new ElementPort(); body.root = true; body.dataset["theme"] = "dark";
  const documentElement = new ElementPort(); documentElement.root = true;
  let hasFocus = true;
  const doc = Object.assign(new EventTarget(), { body, documentElement, visibilityState: "visible", fullscreenElement: null, hasFocus: () => hasFocus, createElement: () => new ElementPort() });
  const media = Object.assign(new EventTarget(), { matches: true });
  const localStorage = memoryStorage();
  const win = Object.assign(new EventTarget(), { localStorage, matchMedia: () => media, requestAnimationFrame: (callback: FrameRequestCallback) => Number(setTimeout(() => callback(Date.now()), 16)), cancelAnimationFrame: (timer: number) => clearTimeout(timer), open: vi.fn() });
  vi.stubGlobal("window", win); vi.stubGlobal("document", doc); vi.stubGlobal("Node", ElementPort);
  vi.stubGlobal("MutationObserver", class { observe(): void {} disconnect(): void {} });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-logo"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const receipts: Receipt[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (path === "/v1/config") return Response.json({ killSwitch: false, caps: {}, projections: { off: "0", light: "0", standard: "0", max: "0" } });
    if (path === "/v1/balance") return Response.json({ availableMicros: "0", lifetimeMicros: "0" });
    if (path === "/v1/serve") return Response.json({ creatives: [{ creativeId: "creative-1", advertiser: "Sponsor", headline: "A useful tool", body: null, clickUrl: "https://example.com/", logoLight: "https://adcode.bluethenics.com/assets/logo-light.png", logoDark: "https://adcode.bluethenics.com/assets/logo-dark.png", ttlMs: 600_000 }] });
    if (path.startsWith("/api/ad-assets/")) return new Response(PNG);
    if (path === "/v1/receipts") { const posted = JSON.parse(String(init?.body)) as { receipts: Receipt[] }; receipts.push(...posted.receipts); return Response.json({ acked: posted.receipts.map(one => one.receiptId) }); }
    throw new Error(`Unexpected route ${path}`);
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { body, doc, win, fetchImpl, receipts, blur() { hasFocus = false; win.dispatchEvent(new Event("blur")); }, focus() { hasFocus = true; win.dispatchEvent(new Event("focus")); } };
}

describe("browser card lifecycle with the existing ad core", () => {
  it("does not block mount, waits a minute, earns only a painted dwell and cleans up", async () => {
    const f = domFixture(); const mounted = mountBrowserAds(session());
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.body.children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(59_999); expect(f.body.children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(40); expect(f.body.children).toHaveLength(1);
    expect(f.receipts).toHaveLength(0);
    const serve = f.fetchImpl.mock.calls.find(([path]) => path === "/v1/serve");
    expect(JSON.parse(String(serve?.[1]?.body))).toEqual({ tags: [], themeKind: "dark", count: 1 });
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.body.children).toHaveLength(0); expect(f.receipts).toHaveLength(1); expect(f.receipts[0]?.outcome).toBe("impression");
    mounted.dispose(); expect(vi.getTimerCount()).toBe(0);
    const requests = f.fetchImpl.mock.calls.length; await vi.advanceTimersByTimeAsync(600_000); expect(f.fetchImpl).toHaveBeenCalledTimes(requests);
  });

  it("pauses on hover and drops the impression after window focus was interrupted", async () => {
    const f = domFixture(); const mounted = mountBrowserAds(session());
    await vi.advanceTimersByTimeAsync(60_040); const card = f.body.children[0]!;
    card.dispatchEvent(new Event("mouseenter")); await vi.advanceTimersByTimeAsync(20_000); expect(f.body.children).toHaveLength(1);
    card.dispatchEvent(new Event("mouseleave")); f.blur(); await vi.advanceTimersByTimeAsync(20_000); expect(f.body.children).toHaveLength(1);
    f.focus(); await vi.advanceTimersByTimeAsync(8000);
    expect(f.body.children).toHaveLength(0); expect(f.receipts).toHaveLength(0); mounted.dispose();
  });
});
