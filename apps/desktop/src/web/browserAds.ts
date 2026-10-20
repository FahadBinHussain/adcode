/** The existing ad client, with browser ports and no coding sandbox. */
import {
  createAdClient, createAdRenderer, createAdService, createAssetCache, createReceiptQueue,
  type AdService, type FileStore, type HttpRequest, type HttpResponse, type HttpTransport,
  type NotificationHandle, type NotificationSink, type Receipt, type SponsoredNotification,
  type ThemeKind, type TokenProvider,
} from "@adcode/ads";
import type { WebSession } from "./gate.ts";
import "./browserAds.css";

declare const __ADCODE_WEB_DEV__: boolean;
const API_ORIGIN = "https://adcode.bluethenics.com";
const ASSET_HOST = "adcode.bluethenics.com";
const MAX_ASSET_BYTES = 2_000_000;
const MAX_RECEIPT_BYTES = 256_000;
const API_METHODS: Readonly<Record<string, string>> = { "/v1/config": "GET", "/v1/balance": "GET", "/v1/serve": "POST", "/v1/receipts": "POST" };
const encoder = new TextEncoder();

async function refreshedToken(session: WebSession): Promise<string | null> {
  if (!session.uid) return null;
  const token = await session.refresh();
  if (!token || token === "dev") return null;
  // This is an account-switch guard, not authentication. The API verifies the signature.
  try {
    const part = token.split(".")[1]; if (part === undefined) return null;
    const claims: unknown = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims === null || typeof claims !== "object" || !("sub" in claims) || claims.sub !== session.uid) return null;
    return token;
  } catch { return null; }
}

/** No token is cached or written to storage. Firebase owns its refresh lifecycle. */
export function createBrowserAdTokens(session: WebSession): TokenProvider {
  let force = false;
  return {
    async getToken() {
      try {
        if (force) { force = false; await session.refresh(true); }
        const token = await refreshedToken(session);
        return token === null ? { ok: false, error: { kind: "auth", detail: "Sign in to receive sponsored cards." } } : { ok: true, value: token };
      } catch { return { ok: false, error: { kind: "auth", detail: "Sign-in could not be refreshed." } }; }
    },
    invalidate() { force = true; },
  };
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Sponsored response is too large."); }
  const reader = response.body?.getReader(); if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Sponsored response is too large."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

/** A closed set of same-origin routes. Even artwork requests carry current authentication. */
export function createBrowserAdTransport(session: WebSession, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): HttpTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const url = new URL(req.url);
      if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash) throw new Error("Sponsored request destination is not allowed.");
      const asset = /^\/assets\/([A-Za-z0-9_-]{1,80}\.(?:png|jpg|webp))$/.exec(url.pathname);
      if (asset === null && API_METHODS[url.pathname] !== req.method || asset !== null && req.method !== "GET") throw new Error("Sponsored request route is not allowed.");
      if (req.body !== undefined && encoder.encode(req.body).byteLength > 512_000) throw new Error("Sponsored request is too large.");
      options.signal?.throwIfAborted();
      const token = await refreshedToken(session); if (token === null) throw new Error("Sponsored request needs the signed-in account.");
      options.signal?.throwIfAborted();
      const controller = new AbortController(); const abort = (): void => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, Math.max(1, Math.min(3000, Number.isFinite(req.timeoutMs) ? req.timeoutMs : 3000)));
      try {
        const response = await fetchImpl(asset === null ? url.pathname : `/api/ad-assets/${asset[1]!}`, {
          method: req.method, redirect: "manual", credentials: "omit", signal: controller.signal,
          headers: { authorization: `Bearer ${token}`, accept: asset === null ? "application/json" : "image/png,image/jpeg,image/webp", "x-adcode-platform": "web", ...(req.body === undefined ? {} : { "content-type": "application/json" }) },
          ...(req.body === undefined ? {} : { body: req.body }),
        });
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("Sponsored request redirected."); }
        const body = await readBounded(response, asset === null ? MAX_RECEIPT_BYTES : MAX_ASSET_BYTES, controller.signal);
        if (asset !== null && response.status >= 200 && response.status < 300 && imageType(body) === null) throw new Error("Sponsored artwork is not a supported image.");
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => { headers[name] = value; });
        return { status: response.status, headers, body };
      } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
    },
  };
}

function receiptData(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > MAX_RECEIPT_BYTES) return encoder.encode("[]");
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!Array.isArray(raw)) return encoder.encode("[]");
    const receipts: Receipt[] = [];
    for (const item of raw.slice(-500)) {
      if (item === null || typeof item !== "object") continue;
      const one = item as Record<string, unknown>;
      if (typeof one["receiptId"] !== "string" || one["receiptId"].length > 128 || typeof one["creativeId"] !== "string" || one["creativeId"].length > 128 ||
          typeof one["shownAt"] !== "number" || !Number.isFinite(one["shownAt"]) || typeof one["dwellMs"] !== "number" || !Number.isFinite(one["dwellMs"]) || one["dwellMs"] < 0 ||
          !["light", "dark"].includes(String(one["themeKind"])) || !["impression", "click", "dismissed"].includes(String(one["outcome"]))) continue;
      receipts.push({ receiptId: one["receiptId"], creativeId: one["creativeId"], shownAt: one["shownAt"], dwellMs: one["dwellMs"], themeKind: one["themeKind"] as ThemeKind, outcome: one["outcome"] as Receipt["outcome"] });
    }
    return encoder.encode(JSON.stringify(receipts));
  } catch { return encoder.encode("[]"); }
}

/** Only bounded receipt data is persistent. Artwork uses a 2 MB total memory LRU. */
export function createBrowserAdStore(uid: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): FileStore & { clear(): void } {
  const namespace = `adcode:web:ad-receipts:${encodeURIComponent(uid)}`;
  const assets = new Map<string, Uint8Array>(); let assetBytes = 0; let fallback: Uint8Array | null = null;
  return {
    async read(key) {
      if (key === "ads/receipts.json") {
        try { const saved = storage?.getItem(namespace); if (saved !== undefined && saved !== null) return saved.length > MAX_RECEIPT_BYTES ? encoder.encode("[]") : receiptData(encoder.encode(saved)); } catch { /* Private browsing or full storage: keep the in-memory queue. */ }
        return fallback;
      }
      if (!key.startsWith("ads/assets/")) return null;
      const bytes = assets.get(key); if (bytes === undefined) return null;
      assets.delete(key); assets.set(key, bytes); return bytes.slice();
    },
    async write(key, bytes) {
      if (key === "ads/receipts.json") {
        fallback = receiptData(bytes);
        try { storage?.setItem(namespace, new TextDecoder().decode(fallback)); } catch { /* A failed receipt write must not affect editing. */ }
        return;
      }
      if (!key.startsWith("ads/assets/") || bytes.byteLength > MAX_ASSET_BYTES) return;
      const previous = assets.get(key); if (previous !== undefined) { assetBytes -= previous.byteLength; assets.delete(key); }
      while (assetBytes + bytes.byteLength > MAX_ASSET_BYTES && assets.size > 0) {
        const oldest = assets.keys().next().value!; assetBytes -= assets.get(oldest)!.byteLength; assets.delete(oldest);
      }
      assets.set(key, bytes.slice()); assetBytes += bytes.byteLength;
    },
    async delete(key) {
      if (key === "ads/receipts.json") { fallback = null; try { storage?.removeItem(namespace); } catch { /* contained */ } return; }
      const bytes = assets.get(key); if (bytes !== undefined) { assetBytes -= bytes.byteLength; assets.delete(key); }
    },
    clear() { assets.clear(); assetBytes = 0; fallback = null; },
  };
}

function safeClick(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** Mount off the startup path. Every failure costs a card, never a chat or keystroke. */
function mountBrowserAdsInternal(session: WebSession): { dispose(): void } {
  if (!session.uid || session.token === "dev" || typeof __ADCODE_WEB_DEV__ !== "undefined" && __ADCODE_WEB_DEV__) return { dispose() {} };
  let disposed = false; let ready = false; let ticking = false; let flushing = false;
  let service: AdService; let tickTimer: ReturnType<typeof setInterval> | undefined;
  let clearToast: (() => void) | null = null;
  const controller = new AbortController(); const clock = { now: () => Date.now() };
  let storage: Storage | null = null; try { storage = window.localStorage; } catch { /* Storage can be unavailable. */ }
  const store = createBrowserAdStore(session.uid, storage);
  const focused = (): boolean => document.visibilityState === "visible" && document.hasFocus();
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = (): ThemeKind => {
    const setting = document.documentElement.dataset["theme"] ?? document.body.dataset["theme"];
    return setting === "dark" || setting === "light" ? setting : media.matches ? "dark" : "light";
  };
  const tokens = createBrowserAdTokens(session);
  const http = createBrowserAdTransport(session, { signal: controller.signal });
  const assets = createAssetCache({ http, store, clock, allowedHost: ASSET_HOST, maxBytes: MAX_ASSET_BYTES });
  const queue = createReceiptQueue({ store });
  const client = createAdClient({ http, tokens, clock, baseUrl: `${API_ORIGIN}/v1`, assetHost: ASSET_HOST, maxAttempts: 1 });
  const flush = (): void => {
    if (disposed || flushing) return;
    flushing = true;
    void service.flushReceipts().catch(() => undefined).finally(() => { flushing = false; });
  };

  const sink: NotificationSink = {
    show(initial: SponsoredNotification): NotificationHandle {
      const card = document.createElement("aside"); card.className = "browser-sponsored"; card.setAttribute("aria-label", "Sponsored card");
      const logo = document.createElement("img"); logo.className = "browser-sponsored-logo"; logo.alt = ""; logo.hidden = true;
      const text = document.createElement("div"); text.className = "browser-sponsored-copy";
      const label = document.createElement("p"); label.className = "browser-sponsored-label";
      const heading = document.createElement("p"); heading.className = "browser-sponsored-heading";
      const detail = document.createElement("p"); detail.className = "browser-sponsored-detail";
      const visit = document.createElement("button"); visit.type = "button"; visit.className = "browser-sponsored-visit"; visit.textContent = "Learn more ↗";
      const close = document.createElement("button"); close.type = "button"; close.className = "browser-sponsored-close"; close.textContent = "×"; close.setAttribute("aria-label", "Dismiss sponsored card");
      text.append(label, heading, detail, visit); card.append(logo, text, close);
      let notification = initial; let objectUrl: string | null = null; let imageGeneration = 0;
      let timer: ReturnType<typeof setTimeout> | undefined; let remaining = initial.autoDismissMs; let resumedAt = 0;
      let hover = false; let keyboardFocus = false; let painted = false; let removed = false; let frame = 0;
      const pause = (): void => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; remaining = Math.max(0, remaining - (clock.now() - resumedAt)); } };
      const arm = (): void => {
        pause();
        if (removed || !painted || hover || keyboardFocus || !focused()) return;
        resumedAt = clock.now(); timer = setTimeout(() => { timer = undefined; service.dismiss(); flush(); }, remaining);
      };
      const synchronize = (): void => { service.onFocusChange(focused()); arm(); };
      const cleanup = (): void => {
        if (removed) return; removed = true; pause(); imageGeneration += 1;
        if (frame !== 0) window.cancelAnimationFrame(frame);
        window.removeEventListener("focus", synchronize); window.removeEventListener("blur", synchronize); document.removeEventListener("visibilitychange", synchronize);
        if (objectUrl !== null) URL.revokeObjectURL(objectUrl); card.remove(); if (clearToast === cleanup) clearToast = null;
      };
      const update = (next: SponsoredNotification): void => {
        notification = next; label.textContent = `Sponsored · ${next.advertiser}`; heading.textContent = next.headline; detail.textContent = next.body ?? ""; detail.hidden = next.body === null;
        visit.disabled = safeClick(next.clickUrl) === null; const generation = ++imageGeneration;
        void assets.get(next.logo).then(result => {
          if (removed || disposed || generation !== imageGeneration || !result.ok) return;
          const mime = imageType(result.value); if (mime === null) return;
          if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.value)], { type: mime })); logo.src = objectUrl; logo.hidden = false;
        }).catch(() => undefined);
      };
      visit.addEventListener("click", event => {
        if (!event.isTrusted || disposed || safeClick(notification.clickUrl) === null) return;
        const destination = service.click(); if (destination !== null) { const allowed = safeClick(destination); if (allowed !== null) window.open(allowed, "_blank", "noopener,noreferrer"); }
        flush();
      });
      close.addEventListener("click", () => { service.dismiss(); flush(); });
      card.addEventListener("mouseenter", () => { hover = true; pause(); }); card.addEventListener("mouseleave", () => { hover = false; arm(); });
      card.addEventListener("focusin", () => { keyboardFocus = true; pause(); });
      card.addEventListener("focusout", event => { keyboardFocus = event.relatedTarget instanceof Node && card.contains(event.relatedTarget); arm(); });
      window.addEventListener("focus", synchronize); window.addEventListener("blur", synchronize); document.addEventListener("visibilitychange", synchronize);
      update(initial); document.body.append(card); clearToast = cleanup;
      // Two frames put the acknowledgment after a paint opportunity, without moving focus.
      frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(() => {
        if (removed || disposed) return;
        synchronize();
        painted = true;
        if (card.isConnected && card.getClientRects().length > 0 && focused()) service.onPainted();
        arm();
      }); });
      return { update, dismiss: cleanup };
    },
  };
  const renderer = createAdRenderer({ sink, clock, newId: () => crypto.randomUUID(), onReceipt(receipt) { void queue.enqueue(receipt).then(flush).catch(() => undefined); }, isSuppressed: () => disposed || !focused() || document.fullscreenElement !== null });
  service = createAdService({ clock, client, tokens, assets, queue, renderer, settings: { adsEnabled: true, preset: "standard" }, ide: {
    windowFocused: focused, debugActive: () => false, doNotDisturb: () => document.fullscreenElement !== null, themeKind: theme,
    languageIds: () => [], filenames: () => [],
  } });
  const focusChanged = (): void => service.onFocusChange(focused());
  const themeChanged = (): void => service.onThemeChange(theme());
  const tick = (): void => {
    if (disposed || !ready || ticking || !focused() || renderer.isShowing()) return;
    ticking = true; themeChanged();
    void service.tick().catch(() => undefined).finally(() => { ticking = false; });
  };
  const dispose = (): void => {
    if (disposed) return; disposed = true;
    if (tickTimer !== undefined) clearInterval(tickTimer);
    service.stop(); service.onFocusChange(false); service.dismiss(); clearToast?.(); controller.abort(); store.clear();
    window.removeEventListener("focus", focusChanged); window.removeEventListener("blur", focusChanged); window.removeEventListener("pagehide", dispose);
    document.removeEventListener("visibilitychange", focusChanged); media.removeEventListener("change", themeChanged); observer.disconnect();
  };
  const observer = new MutationObserver(themeChanged); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  window.addEventListener("focus", focusChanged); window.addEventListener("blur", focusChanged); window.addEventListener("pagehide", dispose);
  document.addEventListener("visibilitychange", focusChanged); media.addEventListener("change", themeChanged);
  tickTimer = setInterval(tick, 60_000);
  void Promise.resolve().then(async () => { if (disposed) return; await service.start(); ready = !disposed; }).catch(() => undefined);
  return { dispose };
}

export function mountBrowserAds(session: WebSession): { dispose(): void } {
  try { return mountBrowserAdsInternal(session); } catch { return { dispose() {} }; }
}
