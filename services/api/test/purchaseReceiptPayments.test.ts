import { describe, expect, it, vi } from "vitest";
import { parseReceiptPayment } from "../src/purchaseReceiptPayments.ts";
import { handleFundingWebhook } from "../src/funding.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { sign } from "../src/billing.ts";

const now = Date.parse("2026-10-27T12:00:00Z");
const secret = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
const payment = () => ({ type: "payment.succeeded", timestamp: new Date(now).toISOString(), data: {
  payment_id: "pay_1", subscription_id: "sub_1", total_amount: 750, currency: "USD", status: "succeeded",
  customer: { customer_id: "customer_1", email: "untrusted@example.test" },
  metadata: { uid: "not-an-owner", plan: "pro" },
} });

describe("verified receipt charge facts", () => {
  it("uses actual charged total/currency and drops provider email and metadata identity", () => {
    expect(parseReceiptPayment(payment(), "evt_1", now)).toEqual({
      paymentId: "pay_1", webhookId: "evt_1", subscriptionId: "sub_1", orderId: null,
      customerId: "customer_1", amountMinor: 750, currency: "USD", paidAt: now, receivedAt: now,
    });
    const zero = payment(); zero.data.total_amount = 0;
    expect(parseReceiptPayment(zero, "evt_zero", now)?.amountMinor).toBe(0);
    const renewal = payment(); renewal.data.currency = "JPY";
    expect(parseReceiptPayment(renewal, "evt_renew", now)?.currency).toBe("JPY");
  });

  it("refuses non-paid, malformed, unowned and ambiguous multi-subscription facts", () => {
    for (const data of [
      { type: "subscription.active" }, { type: "payment.failed" },
      { data: { ...payment().data, status: "processing" } },
      { data: { ...payment().data, total_amount: -1 } },
      { data: { ...payment().data, total_amount: 1.5 } },
      { data: { ...payment().data, total_amount: "750" } },
      { data: { ...payment().data, total_amount: Number.MAX_SAFE_INTEGER + 1 } },
      { data: { ...payment().data, currency: "usd" } },
      { data: { ...payment().data, customer: { email: "guess@example.test" } } },
      { data: { ...payment().data, subscription_id: null } },
      { data: { ...payment().data, is_multi_subscription: true } },
      { data: { ...payment().data, is_update_payment_method: true, total_amount: 0 } },
      { timestamp: "not a date" }, { timestamp: new Date(now + 300_001).toISOString() },
    ]) expect(parseReceiptPayment({ ...payment(), ...data }, "evt_1", now)).toBeNull();
  });

  it("journals subscription charges only after raw signature verification and retries storage failure", async () => {
    const store = createMemoryStore();
    const recordReceiptPayment = vi.fn(async () => {});
    const deps = { store: { ...store, recordReceiptPayment }, clock: { now: () => now }, webhookSecret: secret };
    const raw = JSON.stringify(payment()), timestamp = String(now / 1000);
    const headers = { id: "evt_1", timestamp, signature: `v1,${sign(secret, "evt_1", timestamp, raw)}` };
    expect(await handleFundingWebhook(deps, { ...headers, signature: "v1,forged" }, raw)).toMatchObject({ ok: false });
    expect(recordReceiptPayment).not.toHaveBeenCalled();
    await handleFundingWebhook(deps, headers, raw);
    expect(recordReceiptPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentId: "pay_1", amountMinor: 750 }));
    // Fulfilment is never held back by the receipt journal; the provider retries for the receipt.
    recordReceiptPayment.mockRejectedValueOnce(new Error("journal unavailable"));
    const fulfil = vi.spyOn(deps.store, "applyTokenEvent");
    const pack = JSON.stringify({ ...payment(), data: { ...payment().data, subscription_id: null, checkout_session_id: "cs_1", metadata: { orderId: "ait_1" } } });
    const packHeaders = { id: "evt_2", timestamp, signature: `v1,${sign(secret, "evt_2", timestamp, pack)}` };
    expect(await handleFundingWebhook(deps, packHeaders, pack)).toEqual({ ok: false, status: 503, reason: "receipt-journal" });
    expect(fulfil).toHaveBeenCalledWith(expect.objectContaining({ type: "purchase", orderId: "ait_1" }));
  });
});
