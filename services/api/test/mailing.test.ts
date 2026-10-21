import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { runAnnouncementBatch, runMailingBatch, verifyMailingWebhook } from "../src/mailingDelivery.ts";
import type { AnnouncementJob, EmailJob, MailingStore } from "../src/mailing.ts";

const now = 1_800_000_000_000;
const token = "11111111-1111-4111-8111-111111111111";
const secret = "whsec_" + Buffer.from("a sufficiently long webhook secret").toString("base64");
function mailingStore(): MailingStore {
  let subscribed = false, statusUpdates = false, modelUpdates = false;
  return {
    preferences: vi.fn(async () => ({ subscribed, email: "builder@example.test", eligible: true, suppressed: false, statusUpdates, modelUpdates })),
    consent: vi.fn(async (_uid, enabled) => { subscribed = enabled; }),
    setStatusUpdates: vi.fn(async (_uid, enabled) => { statusUpdates = enabled; }),
    unsubscribeStatus: vi.fn(async () => { statusUpdates = false; }),
    setModelUpdates: vi.fn(async (_uid, enabled) => { modelUpdates = enabled; }),
    unsubscribeModels: vi.fn(async () => { modelUpdates = false; }),
    announce: vi.fn(async () => 3),
    claimAnnouncements: vi.fn(async () => []),
    finishAnnouncement: vi.fn(async () => {}),
    undeliverable: vi.fn(async () => false),
    recordReportReply: vi.fn(async () => {}),
    repliedAt: vi.fn(async () => ({})),
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
    vi.mocked(store.preferences).mockResolvedValue({ subscribed: false, email: null, eligible: false, suppressed: false, statusUpdates: false, modelUpdates: false });
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

describe("status updates, announcements and report replies", () => {
  const headers = { authorization: "Bearer valid", "content-type": "application/json" };
  const adminVerifier = { async verify(value: string) {
    if (value === "admin") return { uid: "admin-1", claims: { email: "admin@example.test", email_verified: true } };
    return value === "valid" ? { uid: "builder", claims: { email: "builder@example.test", email_verified: true } } : null;
  } };
  async function adminApi(mailing: MailingStore, extra: Record<string, unknown> = {}) {
    const store = createMemoryStore();
    await store.addAdmin({ email: "admin@example.test", addedBy: "setup", addedAt: 0 });
    const api = createFetchHandler({ mailing, mailingWebhookSecret: () => secret, store, clock: { now: () => now }, verifier: adminVerifier, siteOrigin: "https://site.test", ...extra });
    return { store, api };
  }
  const asAdmin = { authorization: "Bearer admin", "content-type": "application/json" };

  it("keeps status updates a separate yes, and keeps it when updates are turned off", async () => {
    const mailing = mailingStore(), api = handler(mailing);
    const patch = (body: unknown) => api(new Request("https://site.test/v1/email-preferences", { method: "PATCH", headers, body: JSON.stringify(body) }));
    expect((await patch({ statusUpdates: "yes" })).status).toBe(400);
    expect((await patch({ statusUpdates: true, email: "other@example.test" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const saved = await patch({ statusUpdates: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ statusUpdates: true, subscribed: false });
    expect(mailing.consent).not.toHaveBeenCalled();
    await patch({ subscribed: false });
    expect(mailing.setStatusUpdates).toHaveBeenLastCalledWith("builder", true, now);
  });

  it("gives status emails their own unsubscribe that stops nothing else", async () => {
    const mailing = mailingStore(), api = handler(mailing), url = "https://site.test/v1/email/unsubscribe?token=" + token + "&topic=status";
    const page = await (await api(new Request(url))).text();
    expect(page).toContain("Stop status emails");
    expect(page).toContain("topic=status");
    const oneClick = await api(new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(oneClick.status).toBe(200);
    expect(mailing.unsubscribeStatus).toHaveBeenCalledWith(token, now);
    expect(mailing.unsubscribe).not.toHaveBeenCalled();
  });

  it("announces a published release once, from the release note itself", async () => {
    const mailing = mailingStore();
    const { store, api } = await adminApi(mailing);
    await store.putRelease({ version: "2.4.1", title: "Faster chats", body: "## Changes\n\nChats open **twice** as fast. See [the docs](https://x).\n\nMore below.", highlights: ["Faster chats", "Model fallback"], announce: true, critical: false, status: "published", authoredBy: "human", authorUid: "admin-1", publishedAt: now, updatedAt: now });
    await store.putRelease({ version: "2.5.0", title: "Draft", body: "", highlights: [], announce: false, critical: false, status: "draft", authoredBy: "human", authorUid: "admin-1", publishedAt: null, updatedAt: now });
    const announce = (body: unknown, auth = asAdmin) => api(new Request("https://site.test/v1/admin/email/announce", { method: "POST", headers: auth, body: JSON.stringify(body) }));
    expect((await announce({ topic: "product", release: "2.4.1" }, headers)).status).toBe(403);
    expect((await announce({ topic: "product", release: "2.5.0" })).status).toBe(409);
    const response = await announce({ topic: "product", release: "2.4.1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: 3, sendingEnabled: false });
    expect(mailing.announce).toHaveBeenCalledWith({ topic: "product", ref: "release:2.4.1", subject: "ADCode 2.4.1: Faster chats", by: "admin-1", now,
      payload: { title: "Faster chats", summary: "Chats open twice as fast. See the docs.", highlights: ["Faster chats", "Model fallback"], url: "https://site.test/versions" } });
    vi.mocked(mailing.announce).mockResolvedValueOnce(-1);
    expect((await announce({ topic: "product", release: "2.4.1" })).status).toBe(409);
  });

  it("announces new docs only on the site's own docs paths", async () => {
    const mailing = mailingStore();
    const { api } = await adminApi(mailing);
    const announce = (docs: unknown) => api(new Request("https://site.test/v1/admin/email/announce", { method: "POST", headers: asAdmin, body: JSON.stringify({ topic: "product", docs }) }));
    expect((await announce({ path: "https://evil.test/docs/x", title: "T", summary: "S" })).status).toBe(400);
    expect((await announce({ path: "/docs/../admin", title: "T", summary: "S" })).status).toBe(400);
    expect((await announce({ path: "/docs/background-chats", title: "Background chats", summary: "Run several at once." })).status).toBe(200);
    expect(mailing.announce).toHaveBeenCalledWith(expect.objectContaining({ ref: "docs:/docs/background-chats", subject: "New in the ADCode docs: Background chats",
      payload: { title: "Background chats", summary: "Run several at once.", url: "https://site.test/docs/background-chats" } }));
  });

  it("emails an incident's newest update to status subscribers, once per update", async () => {
    const mailing = mailingStore();
    const { store, api } = await adminApi(mailing);
    await store.createStatusIncident({ incidentId: "inc-1", title: "Free AI is slow", impact: "major", status: "investigating", authorUid: "admin-1", createdAt: now - 2000, updatedAt: now - 2000, resolvedAt: null },
      { updateId: "upd-1", incidentId: "inc-1", status: "investigating", body: "Looking into it.", authorUid: "admin-1", createdAt: now - 2000 });
    await store.addStatusIncidentUpdate("inc-1", { updateId: "upd-2", incidentId: "inc-1", status: "resolved", body: "Fixed: requests move to a healthy model.", authorUid: "admin-1", createdAt: now - 1000 });
    const response = await api(new Request("https://site.test/v1/admin/email/announce", { method: "POST", headers: asAdmin, body: JSON.stringify({ topic: "status", incident: "inc-1" }) }));
    expect(response.status).toBe(200);
    expect(mailing.announce).toHaveBeenCalledWith(expect.objectContaining({ topic: "status", ref: "inc-1/upd-2", subject: "Resolved: Free AI is slow",
      payload: { title: "Free AI is slow", summary: "Fixed: requests move to a healthy model.", status: "resolved", url: "https://site.test/status" } }));
    expect((await api(new Request("https://site.test/v1/admin/email/announce", { method: "POST", headers: asAdmin, body: JSON.stringify({ topic: "status", incident: "nope" }) }))).status).toBe(404);
  });

  it("replies to a report at the account's own address and moves the report on", async () => {
    const mailing = mailingStore();
    const mailer = vi.fn(async () => ({ providerId: "re_reply" }));
    const { store, api } = await adminApi(mailing, { reportReplyMailer: mailer });
    await store.putUser({ uid: "reporter", status: "active", createdAt: now, email: "reporter@example.test", emailVerified: false });
    await store.createReport({ reportId: "rep-1", uid: "reporter", kind: "bug", title: "Free AI refuses me", body: "Signed in but refused", appVersion: "2.3.2", platform: "win32", status: "open", createdAt: now - 5000 });
    const reply = (body: unknown) => api(new Request("https://site.test/v1/admin/reports/rep-1/reply", { method: "POST", headers: asAdmin, body: JSON.stringify(body) }));
    expect((await reply({ message: "  " })).status).toBe(400);
    expect((await reply({ message: "Hi", to: "attacker@example.test" })).status).toBe(400);
    const sent = await reply({ message: "Fixed - the app now emails you a verification link." });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ok: true, status: "triaged", repliedAt: now });
    expect(mailer).toHaveBeenCalledWith(expect.objectContaining({ to: "reporter@example.test", reportTitle: "Free AI refuses me", reportedAt: now - 5000, message: "Fixed - the app now emails you a verification link." }));
    expect(mailing.recordReportReply).toHaveBeenCalledWith(expect.objectContaining({ reportId: "rep-1", authorUid: "admin-1", email: "reporter@example.test", providerId: "re_reply" }));
    expect((await reply({ message: "One more thing.", close: true })).status).toBe(200);
    expect((await store.getReport("rep-1"))?.status).toBe("closed");
    vi.mocked(mailing.undeliverable).mockResolvedValueOnce(true);
    expect((await reply({ message: "Again" })).status).toBe(409);
    const list = await api(new Request("https://site.test/v1/admin/reports", { headers: asAdmin }));
    expect(await list.json()).toMatchObject({ repliedAt: {} });
    expect(mailing.repliedAt).toHaveBeenCalledWith(["rep-1"]);
  });

  it("sends announcements only when enabled, with the status link and a stable key", async () => {
    const mailing = mailingStore();
    const announcement: AnnouncementJob = { id: token, uid: "builder", email: "builder@example.test", attempts: 1, topic: "status", subject: "Resolved: Free AI is slow", payload: { title: "Free AI is slow", summary: "Fixed.", url: "https://site.test/status" }, unsubscribeToken: token };
    const renderAnnouncement = vi.fn(async () => ({ subject: "Resolved", html: "<p>Fixed</p>", text: "Fixed" }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "re_status" }));
    expect((await runAnnouncementBatch({ store: mailing, siteOrigin: "https://site.test", render: renderAnnouncement, fetchImpl, apiKey: "key", webhookSecret: secret })).status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.mocked(mailing.settings).mockResolvedValue({ enabled: true, postalAddress: "A real business postal address", senderVerified: true });
    vi.mocked(mailing.claimAnnouncements).mockResolvedValue([announcement]);
    const result = await runAnnouncementBatch({ store: mailing, siteOrigin: "https://site.test", render: renderAnnouncement, fetchImpl, apiKey: "key", webhookSecret: secret, now: () => now });
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(renderAnnouncement).toHaveBeenCalledWith(announcement, "https://site.test/v1/email/unsubscribe?token=" + token + "&topic=status", "A real business postal address");
    const options = fetchImpl.mock.calls[0]![1]!;
    expect(options.headers).toMatchObject({ "Idempotency-Key": "announce/" + token });
    expect(mailing.finishAnnouncement).toHaveBeenCalledWith(token, { providerId: "re_status" }, now);
  });

  it("keeps model emails a separate yes with their own unsubscribe", async () => {
    const mailing = mailingStore(), api = handler(mailing);
    const patch = (body: unknown) => api(new Request("https://site.test/v1/email-preferences", { method: "PATCH", headers, body: JSON.stringify(body) }));
    expect((await patch({ modelUpdates: "yes" })).status).toBe(400);
    const saved = await patch({ modelUpdates: true });
    expect(await saved.json()).toMatchObject({ modelUpdates: true, statusUpdates: false, subscribed: false });
    expect(mailing.consent).not.toHaveBeenCalled();
    await patch({ subscribed: false });
    expect(mailing.setModelUpdates).toHaveBeenLastCalledWith("builder", true, now);
    const url = "https://site.test/v1/email/unsubscribe?token=" + token + "&topic=models";
    expect(await (await api(new Request(url))).text()).toContain("Stop model emails");
    expect((await api(new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }))).status).toBe(200);
    expect(mailing.unsubscribeModels).toHaveBeenCalledWith(token, now);
    expect(mailing.unsubscribe).not.toHaveBeenCalled();
  });

  it("emails a performance report from the status page's own numbers, and a new model from the catalog", async () => {
    const { DEFAULT_TAGFLOW_CONFIG } = await import("../src/tagflowConfig.ts");
    const mailing = mailingStore();
    const { store, api } = await adminApi(mailing);
    const model = { id: "", name: "", contextWindow: 131_072, maxOutput: 8192, inputPrice: 0, outputPrice: 0 };
    await store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, defaultModel: "qwen", models: [{ ...model, id: "qwen", name: "Qwen 3.8" }, { ...model, id: "glm", name: "GLM 5.3 Flash" }] }, updatedAt: 0, updatedBy: "admin-1" });
    const today = new Date(now).toISOString().slice(0, 10);
    const announce = (body: unknown) => api(new Request("https://site.test/v1/admin/email/announce", { method: "POST", headers: asAdmin, body: JSON.stringify({ topic: "models", ...body as object }) }));
    expect((await announce({ performance: true })).status).toBe(409);
    vi.spyOn(store, "modelOutcomesSince").mockResolvedValue([
      { day: today, provider: "tagflow", model: "qwen", outcome: "ok", count: 199, totalMs: 398_000 },
      { day: today, provider: "tagflow", model: "qwen", outcome: "server", count: 1, totalMs: 100 },
      { day: today, provider: "tagflow", model: "glm", outcome: "ok", count: 50, totalMs: 50_000 },
      { day: today, provider: "ollama", model: "local", outcome: "server", count: 500, totalMs: 0 },
    ]);
    const report = await announce({ performance: true });
    expect(report.status).toBe(200);
    expect(mailing.announce).toHaveBeenLastCalledWith(expect.objectContaining({ topic: "models", ref: "performance:" + today,
      payload: expect.objectContaining({ url: "https://site.test/status", highlights: [expect.stringMatching(/^Qwen 3\.8: 99\.50% of 200 turns answered/), expect.stringMatching(/^GLM 5\.3 Flash: 100\.00% of 50 turns/)] }) }));
    expect((await announce({ model: "nope", summary: "x" })).status).toBe(404);
    expect((await announce({ model: "glm", summary: "" })).status).toBe(400);
    expect((await announce({ model: "glm", summary: "Fast answers.", extra: 1 })).status).toBe(400);
    expect((await announce({ model: "glm", summary: "Fast answers for quick edits." })).status).toBe(200);
    expect(mailing.announce).toHaveBeenLastCalledWith(expect.objectContaining({ ref: "model:glm", subject: "New free model in ADCode: GLM 5.3 Flash",
      payload: { title: "GLM 5.3 Flash is now free in ADCode", summary: "Fast answers for quick edits.", url: "https://site.test/status" } }));
  });

  it("gives a model email its own unsubscribe link", async () => {
    const mailing = mailingStore();
    const job: AnnouncementJob = { id: token, uid: "builder", email: "builder@example.test", attempts: 1, topic: "models", subject: "New model", payload: { title: "GLM", summary: "Fast.", url: "https://site.test/status" }, unsubscribeToken: token };
    const render = vi.fn(async () => ({ subject: "New model", html: "<p>GLM</p>", text: "GLM" }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "re_model" }));
    vi.mocked(mailing.settings).mockResolvedValue({ enabled: true, postalAddress: "A real business postal address", senderVerified: true });
    vi.mocked(mailing.claimAnnouncements).mockResolvedValue([job]);
    await runAnnouncementBatch({ store: mailing, siteOrigin: "https://site.test", render, fetchImpl, apiKey: "key", webhookSecret: secret, now: () => now });
    expect(render).toHaveBeenCalledWith(job, "https://site.test/v1/email/unsubscribe?token=" + token + "&topic=models", "A real business postal address");
  });
});
