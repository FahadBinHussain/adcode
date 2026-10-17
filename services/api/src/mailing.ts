/** Server-side mailing port. No addresses or consent are accepted from public form bodies. */
export interface EmailPreferences {
  subscribed: boolean;
  email: string | null;
  eligible: boolean;
  suppressed: boolean;
}
export interface EmailJob {
  id: string;
  uid: string;
  email: string;
  step: 0 | 1 | 2;
  attempts: number;
  unsubscribeToken: string;
}
export interface MailingStore {
  preferences(uid: string): Promise<EmailPreferences>;
  consent(uid: string, enabled: boolean, now: number): Promise<void>;
  touch(uid: string, now: number): Promise<void>;
  unsubscribe(token: string, now: number): Promise<void>;
  settings(): Promise<{ enabled: boolean; postalAddress: string | null; senderVerified: boolean }>;
  prepare(now: number): Promise<void>;
  claim(now: number, limit: number): Promise<EmailJob[]>;
  eligible(id: string, now: number): Promise<boolean>;
  finish(job: EmailJob, result: { providerId: string } | { retry: boolean; code: string }, now: number): Promise<void>;
  event(id: string, type: string, providerId: string, now: number): Promise<void>;
}
export const MAILING_CAMPAIGN = "return-v1";
export const MAILING_SENDER = "ADCode <adcode@bluethenics.com>";
export const MAILING_REPLY_TO = "adcode@bluethenics.com";
export const MAILING_DOMAIN_ID = "42f20169-8998-4e55-80f7-cee5d55bcac4";
export const UNSUBSCRIBE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
