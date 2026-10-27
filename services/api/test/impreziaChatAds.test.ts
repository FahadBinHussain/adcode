import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { handleServe } from "../src/serve.ts";
import { handleReceipts } from "../src/receipts.ts";
import { handleAdNetworkAdmin } from "../src/adNetworks.ts";
import { adNetworkReadiness, parseAdNetworkConfig, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { impreziaBaseUrl, impreziaContext, impreziaSessionId, packImpression, unpackImpression } from "../src/impreziaChatAds.ts";

const encryption = Buffer.alloc(32, 7).toString("base64");
const LIVE = "api_pub_live_secret", SANDBOX = "api_pub_sandbox_secret";
const config: AdNetworkConfig = { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "1000", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } };
// The shape the sandbox returned on 27 October 2026, trimmed.
const chatAd = () => ({ requestId: "req_1", siteId: "site", placementId: null, ad: { format: "native",
  creative: { brandName: "", title: "Developers. Earn money with your AI app.", description: "Run ads like this, and get paid.", cta: "Sponsored", imageUrl: "https://storage.googleapis.com/imprezia-sandbox/ad.png?sig=1" },
  clickUrl: "https://go-sandbox.imprezia.ai/go/abc", impression: { impressionUuid: "imp-1", beaconToken: { token: "tok", issuedAt: 1_793_104_707_739, kid: "k1" }, servedAt: "2026-10-27T12:38:27.999Z" } } });
let store: ReturnType<typeof createMemoryStore>; let now: number; let counter: number;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
const deps = () => ({ store, clock: { now: () => now }, ids: { next: (prefix: string) => `${prefix}_${++counter}` }, encryptionKeys: () => [encryption], fetchImpl });
const request = { tags: ["lang:typescript", "React", "<script>"], themeKind: "dark" as const, count: 1 };
const receipt = (id: string, outcome: "impression" | "click" = "impression", receiptId = "receipt-1") => ({ receiptId, creativeId: id, shownAt: now - 2_000, dwellMs: 1_500, themeKind: "dark" as const, outcome });
async function connect(key: string, over: Partial<AdNetworkConfig> = {}) {
  await store.adNetworks!.put({ ...config, ...over }, "admin", now);
  await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, key, encryption));
}
beforeEach(() => {
  store = createMemoryStore(); now = 1_793_104_700_000; counter = 0;
  fetchImpl = vi.fn<typeof fetch>(async (input) => String(input).endsWith("/v1/ads/chat") ? Response.json(chatAd()) : new Response(null, { status: 204 }));
});

describe("Imprezia Chat Ads settings", () => {
  it("can be enabled with a payout, unlike the Exchange preview", () => {
    expect(parseAdNetworkConfig(config)).toEqual(config);
    expect(parseAdNetworkConfig({ ...config, imprezia: { kind: "chat", id: "editor_card" } })?.imprezia).toEqual({ kind: "chat", id: "editor_card" });
    expect(parseAdNetworkConfig({ ...config, imprezia: { kind: "chat", id: "bad id" } })).toBeNull();
    expect(parseAdNetworkConfig({ ...config, imprezia: { kind: "app", id: "com.adcode.app" } })).toBeNull();
    expect(adNetworkReadiness(config, true)).toBe("ready");
    expect(adNetworkReadiness(config, false)).toBe("key-required");
  });
  it("picks the environment from the key and sends tags, never the user's prompt", () => {
    expect(impreziaBaseUrl(SANDBOX)).toBe("https://api-sandbox.imprezia.ai");
    expect(impreziaBaseUrl(LIVE)).toBe("https://api.imprezia.ai");
    expect(impreziaContext(["lang:typescript", "React", "<script>"]).request).toBe("Help me with my typescript, React project");
    expect(impreziaSessionId("alice", now)).toBe(impreziaSessionId("alice", now + 1000));
    expect(impreziaSessionId("alice", now)).not.toContain("alice");
    expect(unpackImpression(packImpression({ uuid: "u", token: "t", issuedAt: 5, kid: "k" }))).toEqual({ uuid: "u", token: "t", issuedAt: 5, kid: "k" });
    expect(unpackImpression("provider-ad-1")).toBeNull();
  });
});

describe("Imprezia Chat Ads delivery", () => {
  it("serves a native card server to server, reports the view once and pays the configured rate", async () => {
    await connect(LIVE);
    const served = await handleServe(deps(), "alice", request); const creative = served.creatives[0]!;
    expect(creative).toMatchObject({ advertiser: "Ad via Imprezia", headline: "Developers. Earn money with your AI app.", clickUrl: "https://go-sandbox.imprezia.ai/go/abc" });
    expect(creative.logoLight).toMatch(/\/assets\/network_an_.*_light\.png$/);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.imprezia.ai/v1/ads/chat");
    expect((init!.headers as Record<string, string>)["X-API-Key"]).toBe(LIVE);
    expect(init!.headers as Record<string, string>).not.toHaveProperty("Origin");
    expect(JSON.parse(String(init!.body))).toMatchObject({ request: "Help me with my typescript, React project", sessionId: expect.stringMatching(/^adc_/) });
    expect(JSON.stringify(served)).not.toContain("tok");
    now += 3_000;
    await handleReceipts(deps(), "alice", { receipts: [receipt(creative.creativeId)] });
    await handleReceipts(deps(), "alice", { receipts: [receipt(creative.creativeId, "impression", "again")] });
    const beacons = fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/v1/events/sdk-impression"));
    expect(beacons).toHaveLength(1);
    expect(JSON.parse(String(beacons[0]![1]!.body))).toEqual({ impressionUuid: "imp-1", beaconToken: { token: "tok", issuedAt: 1_793_104_707_739, kid: "k1" } });
    expect((await store.getBalance("alice")).availableMicros).toBe(1000n);
  });
  it("reports a view once even when two copies of its receipt arrive in one batch", async () => {
    await connect(LIVE);
    const { creatives } = await handleServe(deps(), "alice", request); now += 3_000;
    const id = creatives[0]!.creativeId;
    await handleReceipts(deps(), "alice", { receipts: [receipt(id, "impression", "a"), receipt(id, "impression", "b")] });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("sdk-impression"))).toHaveLength(1);
    expect((await store.getBalance("alice")).availableMicros).toBe(1000n);
  });
  it("pays by click when the admin chose clicks, without reporting a second view", async () => {
    await connect(LIVE, { viewPayoutMicros: "0", clickPayoutMicros: "20000" });
    const { creatives } = await handleServe(deps(), "alice", request); now += 3_000;
    await handleReceipts(deps(), "alice", { receipts: [receipt(creatives[0]!.creativeId, "click")] });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("sdk-impression"))).toHaveLength(0);
    expect((await store.getBalance("alice")).availableMicros).toBe(20000n);
  });
  it("delivers sandbox ads but never pays for them", async () => {
    await connect(SANDBOX);
    const { creatives } = await handleServe(deps(), "alice", request);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api-sandbox.imprezia.ai/v1/ads/chat");
    expect((await store.adNetworks!.delivery("alice", creatives[0]!.creativeId))?.viewPayoutMicros).toBe("0");
    now += 3_000;
    await handleReceipts(deps(), "alice", { receipts: [receipt(creatives[0]!.creativeId)] });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("sdk-impression"))).toHaveLength(1);
    expect((await store.getBalance("alice")).availableMicros).toBe(0n);
  });
  it("leaves the slot empty on no fill or a malformed ad, and never shows banner HTML", async () => {
    await connect(LIVE);
    fetchImpl.mockResolvedValueOnce(Response.json({ requestId: "r", ad: null }));
    expect((await handleServe(deps(), "alice", request)).creatives).toEqual([]);
    fetchImpl.mockResolvedValueOnce(Response.json({ ...chatAd(), ad: { ...chatAd().ad, format: "banner" } }));
    expect((await handleServe(deps(), "alice", request)).creatives).toEqual([]);
    fetchImpl.mockResolvedValueOnce(Response.json({ ...chatAd(), ad: { ...chatAd().ad, clickUrl: "javascript:alert(1)" } }));
    expect((await handleServe(deps(), "alice", request)).creatives).toEqual([]);
  });
  it("tests the saved connection from the admin panel and says when the key is a sandbox key", async () => {
    await connect(SANDBOX);
    const result = await handleAdNetworkAdmin(deps(), "admin-1", "/v1/admin/ad-networks/imprezia/test", "POST", {});
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, sandbox: true, creative: { headline: "Developers. Earn money with your AI app." } });
  });
});
