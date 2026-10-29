import { afterEach, describe, expect, it, vi } from "vitest";
import { runPurchaseReceiptBatch, type PurchaseReceiptJob, type PurchaseReceiptMail, type PurchaseReceiptStore } from "../src/purchaseReceipts.ts";

afterEach(() => vi.useRealTimers());

const planJob: PurchaseReceiptJob = {
  id: "job-1", leaseToken: "lease-1", kind: "plan", email: "buyer@example.test", name: "Buyer",
  details: {
    kind: "plan", subscriptionId: "sub_1", amountMinor: 900, currency: "USD", paidAt: 1_000, reference: "pay_1",
  },
};

function setup(job: PurchaseReceiptJob = planJob) {
  let frozen: PurchaseReceiptMail | null = null;
  const store: PurchaseReceiptStore = {
    prepare: vi.fn(async () => {}), claim: vi.fn(async () => [job]),
    eligible: vi.fn(async () => true), finish: vi.fn(async () => {}),
    payload: vi.fn(async (_id, _lease, proposed) => { frozen ??= proposed === null ? null : structuredClone(proposed); return frozen; }),
  };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "sent-1" }), { status: 200 }));
  const options = {
    store, apiKey: "test", webhookSecret: "test", siteOrigin: "https://site.test",
    settings: async () => ({ senderVerified: true, postalAddress: "10 Example Road, Example City" }),
    render: vi.fn(async (_job: PurchaseReceiptJob, _accountUrl: string, _postalAddress: string) => ({ subject: "Receipt", html: "<p>Receipt</p>", text: "Receipt" })),
    fetchImpl: fetcher, now: () => 1000,
  };
  return { store, fetcher, options };
}

describe("purchase receipt delivery", () => {
  it("sends a transactional receipt even when the marketing switch is off", async () => {
    vi.useFakeTimers(); const { store, fetcher, options } = setup();
    const pending = runPurchaseReceiptBatch({
      ...options,
      settings: async () => ({ enabled: false, senderVerified: true, postalAddress: "10 Example Road, Example City" }),
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ sent: 1, failed: 0 });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "Idempotency-Key": "purchase-receipt/job-1" }),
    });
    expect(options.render).toHaveBeenCalledWith(planJob, expect.stringContaining("utm_campaign=purchase-receipt"), "10 Example Road, Example City");
    expect(options.render.mock.calls[0]?.[1]).toContain("/ai-tokens");
    expect(store.finish).toHaveBeenCalledWith("job-1", "lease-1", { providerId: "sent-1" }, 1000);
  });

  it("does not send without the sender, postal address, keys, or https", async () => {
    const { store, fetcher, options } = setup();
    expect((await runPurchaseReceiptBatch({ ...options, apiKey: "" })).status).toBe("configuration-required");
    expect((await runPurchaseReceiptBatch({ ...options, webhookSecret: "" })).status).toBe("configuration-required");
    expect((await runPurchaseReceiptBatch({ ...options, settings: async () => ({ senderVerified: false, postalAddress: "10 Example Road" }) })).status).toBe("configuration-required");
    expect((await runPurchaseReceiptBatch({ ...options, settings: async () => ({ senderVerified: true, postalAddress: null }) })).status).toBe("configuration-required");
    expect((await runPurchaseReceiptBatch({ ...options, settings: async () => ({ senderVerified: true, postalAddress: "short" }) })).status).toBe("configuration-required");
    expect((await runPurchaseReceiptBatch({ ...options, siteOrigin: "http://site.test" })).status).toBe("https-required");
    expect(store.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("opens the advertiser portal for a credit receipt", async () => {
    vi.useFakeTimers();
    const { options } = setup({
      id: "job-2", leaseToken: "lease-2", kind: "advertiser-credit", email: "owner@example.test", name: "Brand",
      details: { kind: "advertiser-credit", amountMinor: 5000, currency: "USD", paidAt: 1000, reference: "pay_2" },
    });
    const pending = runPurchaseReceiptBatch(options); await vi.runAllTimersAsync();
    await pending;
    expect(options.render.mock.calls[0]?.[1]).toContain("/portal");
  });

  it("never calls an accepted send a network failure and stops on rate limiting", async () => {
    const { store, fetcher, options } = setup();
    fetcher.mockResolvedValueOnce(new Response("rate limit", { status: 429 }));
    expect(await runPurchaseReceiptBatch(options)).toMatchObject({ sent: 0, failed: 1 });
    expect(store.finish).toHaveBeenLastCalledWith("job-1", "lease-1", { retry: true, code: "provider-429" }, 1000);
    vi.mocked(store.finish).mockRejectedValueOnce(new Error("ack failed"));
    await expect(runPurchaseReceiptBatch(options)).rejects.toThrow("ack failed");
    expect(store.finish).toHaveBeenLastCalledWith("job-1", "lease-1", { providerId: "sent-1" }, 1000);
  });

  it("drops a receipt whose address was suppressed between prepare and claim", async () => {
    const { store, fetcher, options } = setup();
    vi.mocked(store.eligible).mockResolvedValue(false);
    await runPurchaseReceiptBatch(options);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledWith("job-1", "lease-1", { retry: false, code: "recipient-no-longer-eligible" }, 1000);
  });

  it("reuses the exact persisted request after an ambiguous acknowledgement and a later deployment", async () => {
    vi.useFakeTimers();
    const { store, fetcher, options } = setup();
    vi.mocked(store.finish).mockRejectedValueOnce(new Error("ack failed"));
    await expect(runPurchaseReceiptBatch(options)).rejects.toThrow("ack failed");
    const original = fetcher.mock.calls[0]?.[1]?.body;
    const changedRender = vi.fn(async () => { throw new Error("new template must not rerender an earlier send"); });
    const retry = runPurchaseReceiptBatch({ ...options, siteOrigin: "https://new-site.test",
      settings: async () => ({ senderVerified: true, postalAddress: "Changed address for the next deployment" }), render: changedRender });
    await vi.runAllTimersAsync();
    expect(await retry).toMatchObject({ sent: 1 });
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(original);
    expect(changedRender).not.toHaveBeenCalled();
  });

  it("does not send if its lease is replaced while rendering", async () => {
    const { store, fetcher, options } = setup();
    vi.mocked(store.payload).mockResolvedValue(null);
    await runPurchaseReceiptBatch(options);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });
});
