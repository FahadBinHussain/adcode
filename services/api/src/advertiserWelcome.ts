import type { RenderedMail } from "./mailingDelivery.ts";
import { resendEmail } from "./mailingDelivery.ts";
import type { SendResult } from "./mailing.ts";

export interface AdvertiserWelcomeJob { id: string; email: string; name: string }
export interface AdvertiserWelcomeStore {
  prepare(now: number): Promise<void>;
  claim(now: number, limit: number): Promise<AdvertiserWelcomeJob[]>;
  eligible(id: string, now: number): Promise<boolean>;
  finish(id: string, result: SendResult, now: number): Promise<void>;
}

/** One account-setup email, with a durable lease and provider idempotency on retry. */
export async function runAdvertiserWelcomeBatch(options: {
  store: AdvertiserWelcomeStore;
  settings(): Promise<{ enabled: boolean; senderVerified: boolean; postalAddress: string | null }>;
  apiKey?: string; webhookSecret?: string; siteOrigin: string;
  render(name: string, portalUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch; now?: () => number;
}) {
  const settings = await options.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!options.apiKey || !options.webhookSecret || !settings.senderVerified || !settings.postalAddress || settings.postalAddress.trim().length < 10) return { status: "configuration-required", sent: 0, failed: 0 };
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const now = options.now ?? Date.now;
  await options.store.prepare(now());
  const jobs = await options.store.claim(now(), 10);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    if (!await options.store.eligible(job.id, now())) {
      await options.store.finish(job.id, { retry: false, code: "recipient-no-longer-eligible" }, now());
      continue;
    }
    const portal = new URL("/portal", origin);
    portal.search = new URLSearchParams({ utm_source: "adcode", utm_medium: "email", utm_campaign: "advertiser-welcome" }).toString();
    const mail = await options.render(job.name, portal.href, settings.postalAddress);
    const result = await resendEmail(options.fetchImpl ?? fetch, options.apiKey, "advertiser-welcome/" + job.id, {
      to: [job.email], ...mail, tags: [{ name: "campaign", value: "advertiser-welcome" }],
    });
    // Persistence stays outside the network catch: an accepted send is not a rejection.
    await options.store.finish(job.id, result, now());
    if ("providerId" in result) sent++; else failed++;
    if (!("providerId" in result) && result.code === "provider-429") break;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}
