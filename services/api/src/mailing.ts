/** Server-side mailing port. No addresses or consent are accepted from public form bodies. */
export interface EmailPreferences {
  subscribed: boolean;
  email: string | null;
  eligible: boolean;
  suppressed: boolean;
  /** A separate yes: status-page incidents and their resolution, nothing else. */
  statusUpdates: boolean;
  /** A third yes: a new free model, and how the included models have been performing. */
  modelUpdates: boolean;
}
export interface EmailJob {
  id: string;
  uid: string;
  email: string;
  step: 0 | 1 | 2;
  attempts: number;
  unsubscribeToken: string;
}

/**
 * Announcements: a release or new docs to people who said yes to ADCode updates (`product`, the
 * same consent as the return campaign), or a status-page update to people who said yes to status
 * emails (`status`), or a new included model or a model performance report to people who said yes
 * to model emails (`models`). The payload is a snapshot taken when the announcement is queued, so
 * an email says what the page said at that moment even if the page changes later.
 */
export type AnnouncementTopic = "product" | "status" | "models";
export interface AnnouncementPayload {
  title: string;
  summary: string;
  /** An address on the site itself. */
  url: string;
  /** For status updates: investigating, identified, monitoring or resolved. */
  status?: string;
  /** For releases: a few highlights, each one line. */
  highlights?: string[];
}
export interface AnnouncementJob {
  id: string;
  uid: string;
  email: string;
  attempts: number;
  topic: AnnouncementTopic;
  subject: string;
  payload: AnnouncementPayload;
  unsubscribeToken: string;
}
export interface ReportReplyRecord {
  replyId: string;
  reportId: string;
  authorUid: string;
  email: string;
  body: string;
  providerId: string;
  createdAt: number;
}
export type SendResult = { providerId: string } | { retry: boolean; code: string };

export interface MailingStore {
  preferences(uid: string): Promise<EmailPreferences>;
  consent(uid: string, enabled: boolean, now: number): Promise<void>;
  setStatusUpdates(uid: string, enabled: boolean, now: number): Promise<void>;
  touch(uid: string, now: number): Promise<void>;
  unsubscribe(token: string, now: number): Promise<void>;
  /** The status email's own link: stops status updates and nothing else. */
  unsubscribeStatus(token: string, now: number): Promise<void>;
  setModelUpdates(uid: string, enabled: boolean, now: number): Promise<void>;
  /** The model email's own link: stops model emails and nothing else. */
  unsubscribeModels(token: string, now: number): Promise<void>;
  settings(): Promise<{ enabled: boolean; postalAddress: string | null; senderVerified: boolean }>;
  prepare(now: number): Promise<void>;
  claim(now: number, limit: number): Promise<EmailJob[]>;
  eligible(id: string, now: number): Promise<boolean>;
  finish(job: EmailJob, result: SendResult, now: number): Promise<void>;
  event(id: string, type: string, providerId: string, now: number): Promise<void>;
  /** Queues one announcement for everyone who asked for its topic; -1 when that ref was already announced. */
  announce(input: { topic: AnnouncementTopic; ref: string; subject: string; payload: AnnouncementPayload; by: string; now: number }): Promise<number>;
  claimAnnouncements(now: number, limit: number): Promise<AnnouncementJob[]>;
  finishAnnouncement(id: string, result: SendResult, now: number): Promise<void>;
  /**
   * Whether this address bounced or complained. A direct answer to someone's own report still
   * reaches a person who unsubscribed from updates; it never goes to an address that bounced or
   * marked ADCode as spam.
   */
  undeliverable(email: string): Promise<boolean>;
  recordReportReply(reply: ReportReplyRecord): Promise<void>;
  /** The newest reply time per report, for the reports the admin list is showing. */
  repliedAt(reportIds: readonly string[]): Promise<Record<string, number>>;
}
export const MAILING_CAMPAIGN = "return-v1";
export const MAILING_SENDER = "ADCode <adcode@bluethenics.com>";
export const MAILING_REPLY_TO = "adcode@bluethenics.com";
export const MAILING_DOMAIN_ID = "42f20169-8998-4e55-80f7-cee5d55bcac4";
export const UNSUBSCRIBE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
