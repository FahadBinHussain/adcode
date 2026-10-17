import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MAILING_CAMPAIGN, MAILING_REPLY_TO, MAILING_SENDER,
  type MailingStore, type EmailJob,
} from "./mailing.ts";

export function verifyMailingWebhook(body: string, headers: Record<string, string | undefined>, secret: string, now: number): boolean {
  const id = headers["svix-id"], timestamp = headers["svix-timestamp"], signature = headers["svix-signature"];
  if (!id || id.length > 200 || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  if (!secret.startsWith("whsec_") || secret.length < 20) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(id + "." + timestamp + "." + body).digest();
  return signature.split(" ").some((item) => {
    const [version, value] = item.split(",");
    if (version !== "v1" || !value) return false;
    const offered = Buffer.from(value, "base64");
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  });
}

export interface RenderedMail { subject: string; html: string; text: string }
export interface MailerOptions {
  store: MailingStore;
  apiKey?: string;
  webhookSecret?: string;
  siteOrigin: string;
  render(step: EmailJob["step"], unsubscribeUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A bounded batch; the database owns leases, consent checks, ordering, and daily limits. */
export async function runMailingBatch(options: MailerOptions): Promise<{ status: string; sent: number; failed: number }> {
  const { store, apiKey, webhookSecret } = options;
  const settings = await store.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!apiKey || !webhookSecret || !settings.postalAddress || settings.postalAddress.trim().length < 10) {
    return { status: "configuration-required", sent: 0, failed: 0 };
  }
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const headers = { authorization: "Bearer " + apiKey, "content-type": "application/json" };
  if (!settings.senderVerified) return { status: "domain-not-verified", sent: 0, failed: 0 };
  await store.prepare(now());
  const jobs = await store.claim(now(), 10);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    if (!(await store.eligible(job.id, now()))) continue;
    const unsubscribeUrl = origin.origin + "/v1/email/unsubscribe?token=" + encodeURIComponent(job.unsubscribeToken);
    const mail = await options.render(job.step, unsubscribeUrl, settings.postalAddress);
    let outcome: { providerId: string } | { retry: boolean; code: string };
    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST", headers: { ...headers, "Idempotency-Key": MAILING_CAMPAIGN + "/" + job.id },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          from: MAILING_SENDER, reply_to: MAILING_REPLY_TO, to: [job.email], ...mail,
          headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          tags: [{ name: "campaign", value: MAILING_CAMPAIGN }, { name: "step", value: String(job.step + 1) }],
        }),
      });
      if (response.ok) {
        const data = await response.json() as { id?: string };
        outcome = typeof data.id === "string" ? { providerId: data.id } : { retry: true, code: "invalid-provider-response" };
      } else {
        outcome = { retry: response.status === 429 || response.status >= 500, code: "provider-" + response.status };
      }
    } catch {
      outcome = { retry: true, code: "provider-timeout" };
    }
    // Keep persistence outside the network catch: an accepted email must never be
    // mistaken for a rejected one just because its acknowledgement write failed.
    await store.finish(job, outcome, now());
    if ("providerId" in outcome) sent += 1;
    else failed += 1;
    if (!("providerId" in outcome) && outcome.code === "provider-429") break;
    // Account send limits apply across all clients; keep this batch below two/second.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}
