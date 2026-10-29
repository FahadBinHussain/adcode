/**
 * Purchase receipts: the payment confirmation a buyer gets after a plan period, an
 * AI-token pack, or an advertiser credit top-up is paid.
 *
 * This is transactional mail, so it deliberately does not consult the marketing sending
 * switch or spend the campaign budget. It does wait for a verified sender and a postal
 * address, and it never writes to an address that bounced or complained. The database
 * owns the queue, the one-receipt-per-purchase rule, leases and retries; this file owns
 * the bounded batch and the one idempotent Resend call per job.
 */
import type { RenderedMail } from "./mailingDelivery.ts";
import { resendEmail } from "./mailingDelivery.ts";
import { MAILING_REPLY_TO, MAILING_SENDER, type SendResult } from "./mailing.ts";

export type PurchaseReceiptKind = "plan" | "tokens" | "advertiser-credit";

export interface PlanReceiptDetails {
  kind: "plan";
  subscriptionId: string;
  amountMinor: number;
  currency: string;
  paidAt: number;
  reference: string;
}

export interface TokensReceiptDetails {
  kind: "tokens";
  packId: string;
  tokens: number;
  amountMinor: number;
  currency: string;
  paidAt: number;
  reference: string;
}

export interface CreditReceiptDetails {
  kind: "advertiser-credit";
  amountMinor: number;
  currency: string;
  paidAt: number;
  reference: string;
}

export type PurchaseReceiptDetails = PlanReceiptDetails | TokensReceiptDetails | CreditReceiptDetails;

export interface PurchaseReceiptJob {
  id: string;
  leaseToken: string;
  kind: PurchaseReceiptKind;
  email: string;
  name: string;
  details: PurchaseReceiptDetails;
}

/** The complete provider body is frozen before the first network attempt. */
export interface PurchaseReceiptMail extends RenderedMail {
  from: string;
  reply_to: string;
  to: [string];
  tags: { name: string; value: string }[];
}

export interface PurchaseReceiptStore {
  prepare(now: number): Promise<void>;
  claim(now: number, limit: number): Promise<PurchaseReceiptJob[]>;
  eligible(id: string, leaseToken: string, now: number): Promise<boolean>;
  payload(id: string, leaseToken: string, proposed: PurchaseReceiptMail | null, now: number): Promise<PurchaseReceiptMail | null>;
  finish(id: string, leaseToken: string, result: SendResult, now: number): Promise<void>;
}

/** Where the receipt's action goes: plan and token management, or the advertiser portal. */
export function receiptAccountUrl(origin: URL, kind: PurchaseReceiptKind): string {
  const url = new URL(kind === "advertiser-credit" ? "/portal" : "/ai-tokens", origin);
  url.search = new URLSearchParams({
    utm_source: "adcode", utm_medium: "email", utm_campaign: "purchase-receipt",
  }).toString();
  return url.href;
}

export async function runPurchaseReceiptBatch(options: {
  store: PurchaseReceiptStore;
  /** `enabled` is intentionally ignored: a receipt is not a marketing campaign. */
  settings(): Promise<{ senderVerified: boolean; postalAddress: string | null }>;
  apiKey?: string;
  webhookSecret?: string;
  siteOrigin: string;
  render(job: PurchaseReceiptJob, accountUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<{ status: string; sent: number; failed: number }> {
  const settings = await options.settings();
  if (!options.apiKey || !options.webhookSecret || !settings.senderVerified || !settings.postalAddress || settings.postalAddress.trim().length < 10) {
    return { status: "configuration-required", sent: 0, failed: 0 };
  }
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };

  const now = options.now ?? Date.now;
  await options.store.prepare(now());
  const jobs = await options.store.claim(now(), 10);
  let sent = 0, failed = 0;

  for (const job of jobs) {
    // The address can be suppressed between prepare and claim; never send into a bounce.
    if (!await options.store.eligible(job.id, job.leaseToken, now())) {
      await options.store.finish(job.id, job.leaseToken, { retry: false, code: "recipient-no-longer-eligible" }, now());
      continue;
    }
    let payload = await options.store.payload(job.id, job.leaseToken, null, now());
    if (payload === null) {
      const mail = await options.render(job, receiptAccountUrl(origin, job.kind), settings.postalAddress);
      payload = await options.store.payload(job.id, job.leaseToken, {
        from: MAILING_SENDER, reply_to: MAILING_REPLY_TO, to: [job.email], ...mail,
        tags: [{ name: "campaign", value: "purchase-receipt" }, { name: "kind", value: job.kind }],
      }, now());
    }
    // Another claimant or a changed address may have invalidated this lease while
    // rendering. Only the persisted body can cross the provider boundary.
    if (payload === null || !await options.store.eligible(job.id, job.leaseToken, now())) continue;
    const result = await resendEmail(options.fetchImpl ?? fetch, options.apiKey, "purchase-receipt/" + job.id, { ...payload });
    // Persistence stays outside the network catch: an accepted send is not a rejection.
    await options.store.finish(job.id, job.leaseToken, result, now());
    if ("providerId" in result) sent++;
    else failed++;
    if (!("providerId" in result) && result.code === "provider-429") break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return { status: "complete", sent, failed };
}
