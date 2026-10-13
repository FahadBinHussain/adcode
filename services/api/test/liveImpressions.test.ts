import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";

const NOW = Date.UTC(2026, 9, 12, 12);

describe("live impressions", () => {
  it("returns unscaled recorded counts without AI tokens or generated characters", async () => {
    const store = createMemoryStore();
    await store.putUser({ uid: "private-user", status: "active", createdAt: 1 });
    await store.putUser({ uid: "private-unused-account", status: "active", createdAt: 1 });
    const serve = { uid: "private-user", creativeId: "private-creative", campaignId: "private-campaign", servedAt: NOW, expiresAt: NOW + 1000, maxBidCpmMicros: 1n, clearingCpmMicros: 1n, costMicros: 1n };
    await store.recordServe({ ...serve, serveId: "delivery" });
    await store.recordServe({ ...serve, serveId: "test", uid: "test-user", test: true });
    await store.addActivity({ uid: "private-user", at: NOW, day: "2026-10-12", manualChars: 0, agentChars: 40, acceptedEdits: 2, rejectedEdits: 0, filesTouched: 0, activeMs: 0, sessions: 3 });
    await store.reserveTagflow({ id: "ai", uid: "private-user", day: "2026-10-12", minute: 1, tokens: 100, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits });
    await store.settleTagflow("ai", { inputTokens: 70, outputTokens: 30, costMicros: 0, estimated: false, failed: false });
    await store.settleTagflow("ai", { inputTokens: 70, outputTokens: 30, costMicros: 0, estimated: false, failed: false });
    const handler = createFetchHandler({ store, clock: { now: () => NOW }, verifier: { verify: async () => null } });
    const response = await handler(new Request("https://example.test/v1/impressions"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=15");
    // Two accounts, one seen user, one delivery, two accepted edits, three sessions.
    expect(await response.json()).toEqual({ total: 9, asOf: NOW });
    await store.addActivity({ uid: "private-user", at: NOW, day: "2026-10-12", manualChars: 0, agentChars: 1_000_000, acceptedEdits: 0, rejectedEdits: 0, filesTouched: 0, activeMs: 0, sessions: 0 });
    expect(await store.liveImpressions()).toBe(9);
  });

  it("ignores both pending and settled AI tokens, keeps zero distinct from a failure", async () => {
    const store = createMemoryStore();
    expect(await store.liveImpressions()).toBe(0);
    await store.reserveTagflow({ id: "pending", uid: "user", day: "2026-10-12", minute: 1, tokens: 100, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits });
    expect(await store.liveImpressions()).toBe(0);
    await store.settleTagflow("pending", { inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false, failed: true });
    expect(await store.liveImpressions()).toBe(0);
    await store.reserveTagflow({ id: "successful-ai", uid: "user", day: "2026-10-12", minute: 1, tokens: 100, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits });
    await store.settleTagflow("successful-ai", { inputTokens: 70, outputTokens: 30, costMicros: 0, estimated: false, failed: false });
    expect(await store.liveImpressions()).toBe(0);
    store.liveImpressions = async () => { throw new Error("unavailable"); };
    const handler = createFetchHandler({ store, verifier: { verify: async () => null } });
    expect((await handler(new Request("https://example.test/v1/impressions"))).status).toBe(500);
  });
});
