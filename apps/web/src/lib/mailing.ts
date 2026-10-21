/** Production assembly; only the API and scheduled Worker import this file. */
import { createSupabaseMailingStore } from "@adcode/api/adapters/supabaseMailingStore.ts";
import { runAnnouncementBatch, runMailingBatch, sendReportReply } from "@adcode/api/src/mailingDelivery.ts";

export const mailingStore = createSupabaseMailingStore();
const siteOrigin = (): string => process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com";
const keys = () => ({
  ...(process.env["RESEND_API_KEY"] ? { apiKey: process.env["RESEND_API_KEY"] } : {}),
  ...(process.env["RESEND_WEBHOOK_SECRET"] ? { webhookSecret: process.env["RESEND_WEBHOOK_SECRET"] } : {}),
});

/** The hourly schedule: the return campaign, then announcements and status updates, each bounded. */
export async function runScheduledMailing() {
  const campaign = await runMailingBatch({
    store: mailingStore,
    ...keys(),
    siteOrigin: siteOrigin(),
    // Keep the email renderer out of ordinary website request startup.
    render: async (...args) => (await import("@/emails/Reengagement")).renderReengagement(...args),
  });
  const announcements = await runAnnouncementBatch({
    store: mailingStore,
    ...keys(),
    siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/Announcement")).renderAnnouncement(...args),
  });
  return { campaign, announcements };
}

/** An administrator's reply to a report: rendered here, sent at once through Resend. */
export async function sendReportReplyEmail(input: { replyId: string; to: string; reportTitle: string; reportedAt: number; message: string }) {
  const mail = await (await import("@/emails/ReportReply")).renderReportReply({ reportTitle: input.reportTitle, reportedAt: input.reportedAt, message: input.message });
  const settings = await mailingStore.settings();
  return sendReportReply({ ...keys(), senderVerified: settings.senderVerified }, { replyId: input.replyId, to: input.to, mail });
}
