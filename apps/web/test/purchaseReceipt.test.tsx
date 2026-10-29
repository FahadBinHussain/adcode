import { describe, expect, it } from "vitest";
import { renderPurchaseReceipt } from "../src/emails/PurchaseReceipt";
import type { PurchaseReceiptJob } from "@adcode/api/src/purchaseReceipts.ts";

const paidAt = Date.parse("2026-10-27T00:00:00Z");

function plan(): PurchaseReceiptJob {
  return {
    id: "job-plan", leaseToken: "lease-plan", kind: "plan", email: "buyer@example.test", name: "Sam",
    details: {
      kind: "plan", subscriptionId: "sub_1", amountMinor: 750, currency: "USD", paidAt, reference: "pay_1",
    },
  };
}

function tokens(): PurchaseReceiptJob {
  return {
    id: "job-tokens", leaseToken: "lease-tokens", kind: "tokens", email: "buyer@example.test", name: "Sam",
    details: { kind: "tokens", packId: "140m", tokens: 140_000_000, amountMinor: 2500, currency: "USD", paidAt, reference: "pay_2" },
  };
}

function credit(): PurchaseReceiptJob {
  return {
    id: "job-credit", leaseToken: "lease-credit", kind: "advertiser-credit", email: "owner@example.test", name: "Brand",
    details: { kind: "advertiser-credit", amountMinor: 5000, currency: "USD", paidAt, reference: "pay_3" },
  };
}

const accountUrl = "https://adcode.test/ai-tokens?utm_campaign=purchase-receipt";
const postalAddress = "Bluethenics, 10 Example Road, Example City";

describe("ADCode purchase receipt email", () => {
  it("renders the actual discounted/taxed charge without inventing a plan price or paid period", async () => {
    const mail = await renderPurchaseReceipt(plan(), accountUrl, postalAddress);
    expect(mail.subject).toBe("Your ADCode plan payment receipt");
    expect(mail.html).toContain("$7.50");
    expect(mail.html).toContain("AI plan payment");
    expect(mail.html).not.toContain("$9.00");
    expect(mail.html).not.toContain("Covered through");
    expect(mail.html).toContain("pay_1");
    expect(mail.html).toContain("sub_1");
    expect(mail.html).toContain("<strong>Date:</strong>");
    expect(mail.html).toContain("October 27, 2026");
    expect(mail.html).toContain("Manage your plan");
    expect(mail.html).toContain(accountUrl);
    expect(mail.html).toContain(postalAddress);
    expect(mail.html).toContain("Payment received");
    expect(mail.html).not.toMatch(/display:\s*(flex|grid)|<script|<svg/);
    expect(mail.html).not.toMatch(/unsubscribe/i);
    expect(mail.html.match(/<h1\b/g)).toHaveLength(1);
    expect(mail.text).toContain("Your ADCode receipt");
    expect(mail.text).toContain("Dodo Payments");
    expect(mail.text).toContain("transactional message, not marketing");
    expect(Buffer.byteLength(mail.html)).toBeLessThan(102_000);
  });

  it("renders a token pack receipt with the pack's tokens and price", async () => {
    const mail = await renderPurchaseReceipt(tokens(), accountUrl, postalAddress);
    expect(mail.subject).toBe("Your ADCode AI tokens receipt");
    expect(mail.html).toContain("$25.00");
    expect(mail.html).toContain("140M AI tokens");
    expect(mail.html).toContain("One-time purchase");
    expect(mail.html).toContain("View your tokens");
    expect(mail.html).not.toContain("Covered through");
  });

  it("renders an advertiser credit receipt with the portal action", async () => {
    const mail = await renderPurchaseReceipt(credit(), "https://adcode.test/portal", postalAddress);
    expect(mail.subject).toBe("Your ADCode advertising credit receipt");
    expect(mail.html).toContain("$50.00");
    expect(mail.html).toContain("Advertising credit");
    expect(mail.html).toContain("Open your advertiser portal");
    expect(mail.html).toContain("https://adcode.test/portal");
  });

  it("escapes personalization and the postal address", async () => {
    const mail = await renderPurchaseReceipt({ ...plan(), name: "<script>bad</script>" }, accountUrl, "<b>not html</b>");
    expect(mail.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(mail.html).toContain("&lt;b&gt;not html&lt;/b&gt;");
  });

  it("formats the charged currency in its actual minor unit and labels zero-charge confirmations honestly", async () => {
    for (const [currency, amountMinor, expected] of [["JPY", 1500, "1,500"], ["KWD", 1234, "1.234"]] as const) {
      const source = plan();
      const mail = await renderPurchaseReceipt({ ...source, details: { ...source.details, amountMinor, currency } }, accountUrl, postalAddress);
      expect(mail.html).toContain(expected);
      expect(mail.text).toContain(`Currency: ${currency}`);
    }
    const source = plan();
    const free = await renderPurchaseReceipt({ ...source, details: { ...source.details, amountMinor: 0 } }, accountUrl, postalAddress);
    expect(free.html).toContain("No payment collected");
    expect(free.html).not.toContain("Payment received");
    expect(free.subject).toBe("Your ADCode plan confirmation");
  });

  it("retains every allowed minor unit instead of rounding the largest safe charge", async () => {
    const source = plan();
    const mail = await renderPurchaseReceipt({ ...source, details: { ...source.details, amountMinor: Number.MAX_SAFE_INTEGER } }, accountUrl, postalAddress);
    expect(mail.html).toContain("$90,071,992,547,409.91");
    expect(mail.text).toContain("$90,071,992,547,409.91");
  });
});
