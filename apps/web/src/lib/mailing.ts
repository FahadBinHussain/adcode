/** Production assembly; only the API and scheduled Worker import this file. */
import { createSupabaseMailingStore } from "@adcode/api/adapters/supabaseMailingStore.ts";
import { runMailingBatch } from "@adcode/api/src/mailingDelivery.ts";

export const mailingStore = createSupabaseMailingStore();
export function runScheduledMailing() {
  return runMailingBatch({
    store: mailingStore,
    ...(process.env["RESEND_API_KEY"] ? { apiKey: process.env["RESEND_API_KEY"] } : {}),
    ...(process.env["RESEND_WEBHOOK_SECRET"] ? { webhookSecret: process.env["RESEND_WEBHOOK_SECRET"] } : {}),
    siteOrigin: process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com",
    // Keep the email renderer out of ordinary website request startup.
    render: async (...args) => (await import("@/emails/Reengagement")).renderReengagement(...args),
  });
}
