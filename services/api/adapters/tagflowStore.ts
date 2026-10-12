import type { TagflowStore, TagflowUsage } from "../src/tagflowTypes.ts";
import { createModelReportStore } from "./modelReportStore.ts";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
type UsageRow = { uid: string; day: string; requests: number | string; input_tokens: number | string; output_tokens: number | string; cost_micros: number | string; estimated_requests: number | string; reserved_tokens: number | string; reserved_cost_micros: number | string };
const usageFrom = (row: UsageRow): TagflowUsage => ({ uid: row.uid, day: row.day, requests: Number(row.requests), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), costMicros: Number(row.cost_micros), estimatedRequests: Number(row.estimated_requests), reservedTokens: Number(row.reserved_tokens), reservedCostMicros: Number(row.reserved_cost_micros) });
const check = (error: { message: string } | null): void => { if (error !== null) throw new Error(`Tagflow storage: ${error.message}`); };

/** Same lazy, server-only service_role client as the other persistence ports. */
export function createTagflowStore(lazy: () => Promise<SupabaseClient>): TagflowStore {
  return {
    ...createModelReportStore(lazy),
    async getTagflowConfig() {
      const { data, error } = await (await lazy()).from("tagflow_config").select("config, updated_at, updated_by").eq("id", 1).maybeSingle();
      check(error);
      return data === null ? null : { config: data.config, updatedAt: Number(data.updated_at), updatedBy: data.updated_by };
    },
    async putTagflowConfig(record) {
      const { error } = await (await lazy()).from("tagflow_config").upsert({ id: 1, config: record.config, updated_at: record.updatedAt, updated_by: record.updatedBy });
      check(error);
    },
    async getTagflowPolicy(uid) {
      const { data, error } = await (await lazy()).from("tagflow_user_policies").select("policy").eq("uid", uid).maybeSingle();
      check(error); return data?.policy ?? null;
    },
    async putTagflowPolicy(uid, policy) {
      const { error } = await (await lazy()).from("tagflow_user_policies").upsert({ uid, policy }); check(error);
    },
    async getTagflowUsage(uid, day) {
      const { data, error } = await (await lazy()).from("tagflow_usage").select("*").eq("uid", uid).eq("day", day).maybeSingle();
      check(error); return data === null ? null : usageFrom(data as UsageRow);
    },
    async listTagflowUsage(day) {
      const { data, error } = await (await lazy()).from("tagflow_usage").select("*").eq("day", day).order("cost_micros", { ascending: false }).order("uid").limit(200);
      check(error); return (data as UsageRow[]).map(usageFrom);
    },
    async reserveTagflow(request) {
      const { data, error } = await (await lazy()).rpc("reserve_tagflow_usage", { p_id: request.id, p_uid: request.uid, p_day: request.day, p_minute: request.minute, p_tokens: request.tokens, p_cost: request.costMicros, p_requests_limit: request.limits.dailyRequests, p_tokens_limit: request.limits.dailyTokens, p_cost_limit: request.limits.dailyCostMicros, p_rpm: request.limits.requestsPerMinute });
      check(error);
      if (data !== "ok" && data !== "daily-limit" && data !== "rate-limit") throw new Error("Invalid Tagflow reservation result");
      return data;
    },
    async settleTagflow(id, usage) {
      const { error } = await (await lazy()).rpc("settle_tagflow_usage", { p_id: id, p_input: usage.inputTokens, p_output: usage.outputTokens, p_cost: usage.costMicros, p_estimated: usage.estimated, p_failed: usage.failed });
      check(error);
    },
  };
}
