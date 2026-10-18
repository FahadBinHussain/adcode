import type { TagflowConfigRecord, TagflowReservation, TagflowStore, TagflowUsage, TagflowUserPolicy } from "./tagflowTypes.ts";
import { UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE } from "./tagflowConfig.ts";
import type { ModelFeedbackRecord, ModelRequestRecord } from "./tagflowReportTypes.ts";
import { summarizeModelReports } from "./tagflowReports.ts";
import type { ModelAudienceProfile } from "./modelAudience.ts";
import { admitCredits, settleWindow, type CreditWindows } from "./credits.ts";

export function createTagflowMemoryStore(): TagflowStore & { resetTagflow(): void } {
  let config: TagflowConfigRecord | null = null;
  const policies = new Map<string, TagflowUserPolicy>();
  const days = new Map<string, TagflowUsage>();
  const reservations = new Map<string, TagflowReservation & { sessionStartedAt: number | null; weekStartedAt: number | null }>();
  const windows = new Map<string, CreditWindows>();
  const minutes = new Map<string, number>();
  const modelRequests = new Map<string, ModelRequestRecord>();
  const modelFeedback = new Map<string, ModelFeedbackRecord>();
  let collectionStartedAt: number | null = null;
  const profiles = new Map<string,ModelAudienceProfile>();
  const key = (uid: string, day: string): string => `${uid}\u0000${day}`;
  return {
    resetTagflow() { config = null; policies.clear(); days.clear(); reservations.clear(); windows.clear(); minutes.clear(); modelRequests.clear(); modelFeedback.clear(); profiles.clear(); collectionStartedAt = null; },
    async getModelAudienceProfile(uid) { return structuredClone(profiles.get(uid) ?? null); },
    async putModelAudienceProfile(profile) { profiles.set(profile.uid,structuredClone(profile)); },
    async deleteModelAudienceProfile(uid) { profiles.delete(uid); },
    async putModelRequest(record) { modelRequests.set(record.id,structuredClone(record)); collectionStartedAt ??= record.startedAt; },
    async getModelRequest(id) { return structuredClone(modelRequests.get(id) ?? null); },
    async putModelFeedback(record) {
      const previous = modelFeedback.get(record.requestId);
      modelFeedback.set(record.requestId,structuredClone({ ...record, createdAt: previous?.createdAt ?? record.createdAt }));
    },
    async getModelFeedback(requestId,uid) { const row = modelFeedback.get(requestId); return structuredClone(row?.uid === uid ? row : null); },
    async deleteModelFeedback(requestId,uid) { if (modelFeedback.get(requestId)?.uid === uid) modelFeedback.delete(requestId); },
    async readModelReports(range) { return summarizeModelReports([...modelRequests.values()],[...modelFeedback.values()],range,collectionStartedAt,profiles); },
    async getTagflowConfig() { return structuredClone(config); },
    async putTagflowConfig(value) { config = structuredClone(value); },
    async getTagflowPolicy(uid) { return structuredClone(policies.get(uid) ?? null); },
    async putTagflowPolicy(uid, policy) { policies.set(uid, structuredClone(policy)); },
    async getTagflowUsage(uid, day) { return structuredClone(days.get(key(uid, day)) ?? null); },
    async getCreditWindows(uid) { return structuredClone(windows.get(uid) ?? { session: null, week: null }); },
    async listTagflowUsage(day) { return [...days.values()].filter((row) => row.day === day).sort((a, b) => b.costMicros - a.costMicros || a.uid.localeCompare(b.uid)).slice(0, 200).map((row) => structuredClone(row)); },
    async reserveTagflow(request) {
      // No await between checking and writing: this is one atomic operation in memory.
      if (reservations.has(request.id)) throw new Error("Duplicate reservation");
      const row = days.get(key(request.uid, request.day)) ?? { uid: request.uid, day: request.day, requests: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimatedRequests: 0, reservedTokens: 0, reservedCostMicros: 0 };
      const minuteKey = key(request.uid, String(request.minute));
      if (!request.unlimited && ((request.limits.dailyRequests !== UNLIMITED_DAILY_REQUESTS && row.requests + 1 > request.limits.dailyRequests) || row.inputTokens + row.outputTokens + row.reservedTokens + request.tokens > request.limits.dailyTokens || row.costMicros + row.reservedCostMicros + request.costMicros > request.limits.dailyCostMicros)) return "daily-limit";
      const admitted = request.credits === undefined ? null : admitCredits(windows.get(request.uid) ?? { session: null, week: null }, request.credits, request.unlimited);
      if (admitted !== null && !admitted.ok) return admitted.limit;
      if (!request.unlimited && request.limits.requestsPerMinute !== UNLIMITED_REQUESTS_PER_MINUTE && (minutes.get(minuteKey) ?? 0) >= request.limits.requestsPerMinute) return "rate-limit";
      if (admitted !== null) windows.set(request.uid, admitted.windows);
      days.set(key(request.uid, request.day), { ...row, requests: row.requests + 1, reservedTokens: row.reservedTokens + request.tokens, reservedCostMicros: row.reservedCostMicros + request.costMicros });
      minutes.set(minuteKey, (minutes.get(minuteKey) ?? 0) + 1);
      reservations.set(request.id, { ...request, sessionStartedAt: admitted?.ok ? admitted.windows.session.startedAt : null, weekStartedAt: admitted?.ok ? admitted.windows.week.startedAt : null });
      return "ok";
    },
    async settleTagflow(id, usage) {
      const reservation = reservations.get(id);
      if (reservation === undefined) return;
      const row = days.get(key(reservation.uid, reservation.day))!;
      days.set(key(reservation.uid, reservation.day), { ...row,
        requests: row.requests - Number(usage.failed),
        inputTokens: row.inputTokens + usage.inputTokens, outputTokens: row.outputTokens + usage.outputTokens,
        costMicros: row.costMicros + usage.costMicros, estimatedRequests: row.estimatedRequests + Number(usage.estimated && !usage.failed),
        reservedTokens: row.reservedTokens - reservation.tokens, reservedCostMicros: row.reservedCostMicros - reservation.costMicros,
      });
      const held = reservation.credits?.millicredits ?? 0;
      const used = usage.failed ? 0 : usage.millicredits ?? 0;
      const current = windows.get(reservation.uid);
      if (current !== undefined) windows.set(reservation.uid, {
        session: settleWindow(current.session, reservation.sessionStartedAt, held, used),
        week: settleWindow(current.week, reservation.weekStartedAt, held, used),
      });
      reservations.delete(id);
    },
  };
}
