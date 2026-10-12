import type { ModelFeedbackRecord, ModelRequestRecord } from "../src/tagflowReportTypes.ts";
import type { TagflowStore } from "../src/tagflowTypes.ts";
type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
type ReportStore = Pick<TagflowStore, "putModelRequest" | "getModelRequest" | "putModelFeedback" | "getModelFeedback" | "deleteModelFeedback" | "readModelReports" | "getModelAudienceProfile" | "putModelAudienceProfile" | "deleteModelAudienceProfile">;
const fields = ["id", "uid", "modelId", "modelName", "provider", "upstreamModel", "startedAt", "finishedAt", "providerStartedAt", "outcome", "errorCode", "upstreamStatus", "source", "streamed", "toolsOffered", "toolCalls", "finishReason", "contextWindow", "requestedOutput", "estimatedInput", "inputTokens", "outputTokens", "costMicros", "estimated", "durationMs", "firstTokenMs"] as const;
const feedbackFields = ["requestId", "uid", "rating", "category", "comment", "shareWithProvider", "createdAt", "updatedAt"] as const;
const audienceFields = ["uid","role","experience","primaryUse","updatedAt"] as const;
const requestFields = [...fields,"country","aiPersona","useCase","platform"];
const sqlName = (key: string): string => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const encode = (value: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map(key => [sqlName(key), (value as Record<string,unknown>)[key]]));
const decode = (value: Record<string,unknown>, keys: readonly string[]): Record<string,unknown> => Object.fromEntries(keys.map(key => [key,value[sqlName(key)]]));
const check = (error: { message: string } | null): void => { if (error) throw new Error("Model reporting storage unavailable"); };

export function createModelReportStore(lazy: () => Promise<SupabaseClient>): ReportStore {
  return {
    async getModelAudienceProfile(uid) { const { data,error } = await (await lazy()).from("ai_model_audience_profiles").select("*").eq("uid",uid).maybeSingle(); check(error); return data === null ? null : decode(data,audienceFields) as unknown as import("../src/modelAudience.ts").ModelAudienceProfile; },
    async putModelAudienceProfile(profile) { const { error } = await (await lazy()).from("ai_model_audience_profiles").upsert(encode(profile,audienceFields)); check(error); },
    async deleteModelAudienceProfile(uid) { const { error } = await (await lazy()).from("ai_model_audience_profiles").delete().eq("uid",uid); check(error); },
    async putModelRequest(record) { const { error } = await (await lazy()).from("ai_model_requests").upsert(encode({ country:"unknown", aiPersona:"unknown", useCase:"unknown", platform:"unknown", ...record }, requestFields)); check(error); },
    async getModelRequest(id) { const { data,error } = await (await lazy()).from("ai_model_requests").select("*").eq("id",id).maybeSingle(); check(error); return data === null ? null : decode(data,requestFields) as unknown as ModelRequestRecord; },
    async putModelFeedback(record) { const { error } = await (await lazy()).from("ai_model_feedback").upsert(encode(record,feedbackFields)); check(error); },
    async getModelFeedback(requestId,uid) { const { data,error } = await (await lazy()).from("ai_model_feedback").select("*").eq("request_id",requestId).eq("uid",uid).maybeSingle(); check(error); return data === null ? null : decode(data,feedbackFields) as unknown as ModelFeedbackRecord; },
    async deleteModelFeedback(requestId,uid) { const { error } = await (await lazy()).from("ai_model_feedback").delete().eq("request_id",requestId).eq("uid",uid); check(error); },
    async readModelReports(range) {
      const { data,error } = await (await lazy()).rpc("read_ai_model_reports_v2", { p_from: range.fromAt, p_to: range.toAt, p_previous_from: range.previousFromAt });
      check(error); if (!data || !Array.isArray(data.models)) throw new Error("Invalid model report"); return data;
    },
  };
}
