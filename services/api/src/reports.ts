/**
 * Bug reports, feature requests, and help asks.
 *
 * The report is attributed to the verified UID from the token, never to anything in the
 * body - the same rule the money endpoints follow, for the same reason: a field the
 * client controls is a field the client can lie about.
 *
 * Reports carry user-written prose, so an admin reading them is audited exactly as an
 * admin reading a ledger is. The audit row uses `*` as its subject because a list read
 * is not about one person.
 */
import type { SubmitReportBody, SubmitReportResponse } from "./contract.ts";
import { randomUUID } from "node:crypto";
import type { Clock, IdGen, Page, ReportPage, ReportRecord, Store } from "./store.ts";
import type { MailingStore, SendResult } from "./mailing.ts";

export interface ReportDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export async function handleSubmitReport(
  deps: ReportDeps,
  uid: string,
  body: SubmitReportBody,
): Promise<SubmitReportResponse> {
  const reportId = deps.ids.next("rep");

  await deps.store.createReport({
    reportId,
    uid,
    kind: body.kind,
    title: body.title,
    body: body.body,
    appVersion: body.appVersion,
    platform: body.platform,
    status: "open",
    createdAt: deps.clock.now(),
  });

  return { reportId };
}

export async function handleAdminListReports(
  deps: ReportDeps,
  adminUid: string,
  page: Page,
): Promise<ReportPage> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-reports",
    subjectUid: "*",
    at: deps.clock.now(),
  });

  return deps.store.listReports(page);
}

/**
 * Triage.
 *
 * A feedback list with no state is a list that gets re-read from the top every time.
 * `open` / `triaged` / `closed` is the smallest vocabulary that lets an admin work
 * through one: seen and acted on, seen and finished, or not yet looked at.
 */
export async function handleSetReportStatus(
  deps: ReportDeps,
  adminUid: string,
  reportId: string,
  status: ReportRecord["status"],
): Promise<boolean> {
  await deps.store.writeAudit({
    adminUid,
    action: `report:${status}:${reportId}`,
    subjectUid: "*",
    at: deps.clock.now(),
  });

  return deps.store.setReportStatus(reportId, status);
}

/**
 * Really delete it.
 *
 * The one record in this service that is removed rather than superseded, and deliberately
 * so: a ledger entry is evidence about money and must survive its own author, while a
 * duplicate bug report or a page of pasted spam is noise in a queue somebody has to read.
 * The audit row outlives the report, so the deletion itself is still on the record.
 */
export async function handleDeleteReport(
  deps: ReportDeps,
  adminUid: string,
  reportId: string,
): Promise<boolean> {
  await deps.store.writeAudit({
    adminUid,
    action: `report:deleted:${reportId}`,
    subjectUid: "*",
    at: deps.clock.now(),
  });

  return deps.store.deleteReport(reportId);
}

/**
 * Answer the person who filed it, by email.
 *
 * Bug reports used to be a one-way street: someone wrote in, an administrator fixed the thing,
 * and the person never heard. This sends the administrator's own words to the account's email -
 * the address comes from the account, never from the request - records the reply, and moves the
 * report on: in progress, or done when `close` is set. A direct answer still reaches someone who
 * unsubscribed from updates, but never an address that bounced or marked ADCode as spam.
 */
export interface ReportReplyDeps {
  store: Store;
  clock: Clock;
  mailing?: MailingStore;
  mailer?: (input: { replyId: string; to: string; reportTitle: string; reportedAt: number; message: string }) => Promise<SendResult>;
}

export type ReportReplyOutcome =
  | { status: 200; body: { ok: true; status: ReportRecord["status"]; repliedAt: number } }
  | { status: 400 | 404 | 409 | 502 | 503; body: { error: string } };

export async function handleReportReply(deps: ReportReplyDeps, adminUid: string, reportId: string, raw: unknown): Promise<ReportReplyOutcome> {
  const fields = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const message = typeof fields?.["message"] === "string" ? fields["message"].trim() : "";
  if (fields === null || Object.keys(fields).some((key) => key !== "message" && key !== "close") ||
      message.length === 0 || message.length > 5000 || (fields["close"] !== undefined && typeof fields["close"] !== "boolean")) {
    return { status: 400, body: { error: "malformed-reply" } };
  }
  if (deps.mailing === undefined || deps.mailer === undefined) return { status: 503, body: { error: "mailing-unavailable" } };
  const report = await deps.store.getReport(reportId);
  if (report === null) return { status: 404, body: { error: "not-found" } };
  const email = (await deps.store.getUser(report.uid))?.email ?? null;
  if (email === null) return { status: 409, body: { error: "no-email" } };
  if (await deps.mailing.undeliverable(email)) return { status: 409, body: { error: "undeliverable" } };

  const replyId = randomUUID();
  const sent = await deps.mailer({ replyId, to: email, reportTitle: report.title, reportedAt: report.createdAt, message });
  if (!("providerId" in sent)) return { status: 502, body: { error: sent.code } };

  const now = deps.clock.now();
  await deps.mailing.recordReportReply({ replyId, reportId, authorUid: adminUid, email, body: message, providerId: sent.providerId, createdAt: now });
  await deps.store.writeAudit({ adminUid, action: `report:replied:${reportId}`, subjectUid: report.uid, at: now });
  const next: ReportRecord["status"] = fields["close"] === true ? "closed" : report.status === "open" ? "triaged" : report.status;
  if (next !== report.status) await deps.store.setReportStatus(reportId, next);
  return { status: 200, body: { ok: true, status: next, repliedAt: now } };
}
