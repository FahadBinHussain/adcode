import { afterEach, describe, expect, it, vi } from "vitest";
import { runAdvertiserWelcomeBatch, type AdvertiserWelcomeStore } from "../src/advertiserWelcome.ts";

afterEach(() => vi.useRealTimers());
function setup() {
  const store: AdvertiserWelcomeStore = { prepare: vi.fn(async () => {}), claim: vi.fn(async () => [{ id: "job-1", email: "owner@example.test", name: "Brand" }]), eligible: vi.fn(async () => true), finish: vi.fn(async () => {}) };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "sent-1" }), { status: 200 }));
  const options = { store, apiKey: "test", webhookSecret: "test", siteOrigin: "https://site.test", settings: async () => ({ enabled: true, senderVerified: true, postalAddress: "10 Example Road, Example City" }), render: vi.fn(async () => ({ subject: "Welcome", html: "<p>Welcome</p>", text: "Welcome" })), fetchImpl: fetcher, now: () => 1000 };
  return { store, fetcher, options };
}
describe("new advertiser welcome delivery", () => {
  it("sends to the checked account with a stable retry key and records acceptance", async () => {
    vi.useFakeTimers(); const { store, fetcher, options } = setup();
    const pending = runAdvertiserWelcomeBatch(options); await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ sent: 1, failed: 0 });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ "Idempotency-Key": "advertiser-welcome/job-1" }) });
    expect(store.finish).toHaveBeenCalledWith("job-1", { providerId: "sent-1" },1000);
    expect(options.render).toHaveBeenCalledWith("Brand",expect.stringContaining("utm_campaign=advertiser-welcome"),"10 Example Road, Example City");
  });
  it("skips mail when disabled, incomplete, or the recipient changed after the claim", async () => {
    const { store, fetcher, options } = setup();
    expect((await runAdvertiserWelcomeBatch({ ...options, settings: async () => ({ enabled: false, senderVerified: true, postalAddress: "10 Example Road" }) })).status).toBe("disabled");
    expect(store.prepare).not.toHaveBeenCalled();
    expect((await runAdvertiserWelcomeBatch({ ...options, apiKey: "" })).status).toBe("configuration-required");
    vi.mocked(store.eligible).mockResolvedValue(false);
    await runAdvertiserWelcomeBatch(options); expect(fetcher).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledWith("job-1",{ retry: false, code: "recipient-no-longer-eligible" },1000);
  });
  it("stops on rate limiting and never calls an accepted send a network failure", async () => {
    const { store, fetcher, options } = setup();
    fetcher.mockResolvedValueOnce(new Response("rate limit",{status:429}));
    expect(await runAdvertiserWelcomeBatch(options)).toMatchObject({ sent:0,failed:1 });
    expect(store.finish).toHaveBeenLastCalledWith("job-1",{retry:true,code:"provider-429"},1000);
    vi.mocked(store.finish).mockRejectedValueOnce(new Error("ack failed"));
    await expect(runAdvertiserWelcomeBatch(options)).rejects.toThrow("ack failed");
    expect(store.finish).toHaveBeenLastCalledWith("job-1",{providerId:"sent-1"},1000);
  });
});
