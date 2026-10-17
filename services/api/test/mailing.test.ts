import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { runMailingBatch, verifyMailingWebhook } from "../src/mailingDelivery.ts";
import type { EmailJob, MailingStore } from "../src/mailing.ts";

const now = 1_800_000_000_000;
const token = "11111111-1111-4111-8111-111111111111";
const secret = "whsec_" + Buffer.from("a sufficiently long webhook secret").toString("base64");
function mailingStore(): MailingStore {
  let subscribed = false;
  return {
    preferences: vi.fn(async () => ({ subscribed, email: "builder@example.test", eligible: true, suppressed: false })),
    consent: vi.fn(async (_uid, enabled) => { subscribed = enabled; }),
    touch: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => { subscribed = false; }),
    settings: vi.fn(async () => ({ enabled: false, postalAddress: null, senderVerified: false })),
    prepare: vi.fn(async () => {}),
    claim: vi.fn(async () => []),
    eligible: vi.fn(async () => true),
    finish: vi.fn(async () => {}),
    event: vi.fn(async () => {}),
  };
}
function signature(body: string, timestamp = String(now / 1000)) {
  const id = "evt_delivery";
  const digest = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(id + "." + timestamp + "." + body).digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": "v1," + digest };
}
function handler(mailing: MailingStore) {
  return createFetchHandler({
    mailing, mailingWebhookSecret: () => secret, store: createMemoryStore(), clock: { now: () => now },
    verifier: { async verify(value) { return value === "valid" ? { uid: "builder", claims: { email: "builder@example.test", email_verified: true } } : null; } },
  });
}
describe("mailing privacy and recipient controls", () => {
  it("requires auth, rejects recipient injection, and starts unsubscribed", async () => {
    const store = mailingStore(), api = handler(store);
    expect((await api(new Request("https://site.test/v1/email-preferences"))).status).toBe(401);
    const headers = { authorization: "Bearer valid", "content-type": "application/json" };
    const response = await api(new Request("https://site.test/v1/email-preferences", { headers }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ subscribed: false });
    for (const body of [{ subscribed: true, uid: "another" }, { subscribed: "true" }, { subscribed: true, email: "victim@example.test" }]) {
      expect((await api(new Request("https://site.test/v1/email-preferences", { method: "PATCH", headers, body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect(store.consent).not.toHaveBeenCalled();
    expect((await api(new Request("https://site.test/v1/email-preferences", { method: "PATCH", headers, body: '{"subscribed":true}' }))).status).toBe(200);
    expect(store.consent).toHaveBeenCalledWith("builder", true, now);
  });
  it("does not subscribe unverified accounts", async () => {
    const store = mailingStore();
    vi.mocked(store.preferences).mockResolvedValue({ subscribed: false, email: null, eligible: false, suppressed: false });
    const result = await handler(store)(new Request("https://site.test/v1/email-preferences", { method: "PATCH",
      headers: { authorization: "Bearer valid" }, body: '{"subscribed":true}' }));
    expect(result.status).toBe(409);
    expect(store.consent).not.toHaveBeenCalled();
  });
  it("GET never unsubscribes a user, while one-click POST works without login", async () => {
    const store = mailingStore(), api = handler(store), url = "https://site.test/v1/email/unsubscribe?token=" + token;
    const preview = await api(new Request(url));
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('method="post"');
    expect(store.unsubscribe).not.toHaveBeenCalled();
    const oneClick = await api(new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toBe("");
    expect(store.unsubscribe).toHaveBeenCalledWith(token, now);
    expect((await api(new Request("https://site.test/v1/email/unsubscribe?token=invalid"))).status).toBe(400);
  });
  it("rejects forged or expired webhook signatures and awaits durable event storage", async () => {
    const store = mailingStore(), api = handler(store);
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "provider-123" } });
    expect(verifyMailingWebhook(body, signature(body), secret, now)).toBe(true);
    expect(verifyMailingWebhook(body + " ", signature(body), secret, now)).toBe(false);
    expect(verifyMailingWebhook(body, signature(body, String(now / 1000 - 301)), secret, now)).toBe(false);
    expect((await api(new Request("https://site.test/v1/email/webhook", { method: "POST", body }))).status).toBe(400);
    const response = await api(new Request("https://site.test/v1/email/webhook", { method: "POST", headers: signature(body), body }));
    expect(response.status).toBe(200);
    expect(store.event).toHaveBeenCalledWith("evt_delivery", "email.complained", "provider-123", now);
  });
});

const job: EmailJob = { id: token, uid: "builder", email: "builder@example.test", step: 0, attempts: 1, unsubscribeToken: token };
const render = vi.fn(async () => ({ subject: "A new build", html: "<p>Hello</p>", text: "Hello" }));
function enabledStore() {
  const store = mailingStore();
  vi.mocked(store.settings).mockResolvedValue({ enabled: true, postalAddress: "A real business postal address", senderVerified: true });
  vi.mocked(store.claim).mockResolvedValue([job]);
  return store;
}
describe("bounded Resend delivery", () => {
  it("does not contact Resend until explicitly enabled and fully configured", async () => {
    const store = mailingStore(), fetchImpl = vi.fn<typeof fetch>();
    expect((await runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl })).status).toBe("disabled");
    vi.mocked(store.settings).mockResolvedValue({ enabled: true, postalAddress: null, senderVerified: false });
    expect((await runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl })).status).toBe("configuration-required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("blocks delivery while the sending domain is partially failed", async () => {
    const store = enabledStore(), fetchImpl = vi.fn<typeof fetch>();
    vi.mocked(store.settings).mockResolvedValue({ enabled: true, postalAddress: "A real business postal address", senderVerified: false });
    expect((await runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl, apiKey: "key", webhookSecret: secret })).status).toBe("domain-not-verified");
    expect(store.claim).not.toHaveBeenCalled();
  });
  it("rechecks eligibility immediately before sending", async () => {
    const store = enabledStore(), fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "verified" }));
    vi.mocked(store.eligible).mockResolvedValue(false);
    await runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl, apiKey: "key", webhookSecret: secret });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });
  it("uses a stable idempotency key, one recipient, unsubscribe headers, and safe retries", async () => {
    const store = enabledStore();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 429 }));
    const result = await runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl, apiKey: "key", webhookSecret: secret, now: () => now });
    expect(result).toMatchObject({ failed: 1, sent: 0 });
    const options = fetchImpl.mock.calls[0]![1]!;
    expect(options.headers).toMatchObject({ "Idempotency-Key": "return-v1/" + job.id });
    expect(JSON.parse(String(options.body))).toMatchObject({ to: [job.email], from: "ADCode <adcode@bluethenics.com>",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(store.finish).toHaveBeenCalledWith(job, { retry: true, code: "provider-429" }, now);
  });
  it("does not convert an accepted send into a retry when persistence fails", async () => {
    const store = enabledStore();
    vi.mocked(store.finish).mockRejectedValue(new Error("database unavailable"));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "accepted-id" }));
    await expect(runMailingBatch({ store, siteOrigin: "https://site.test", render, fetchImpl, apiKey: "key", webhookSecret: secret })).rejects.toThrow("database unavailable");
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(job, { providerId: "accepted-id" }, expect.any(Number));
  });
});
