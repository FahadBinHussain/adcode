import { UNLIMITED_DAILY_REQUESTS, type TagflowAllowanceView } from "../../shared/tagflow.ts";

const count = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

export function allowanceSummary(view: TagflowAllowanceView) {
  const usedTokens = count(view.usage.inputTokens) + count(view.usage.outputTokens);
  const heldTokens = count(view.usage.reservedTokens);
  return {
    usedTokens,
    heldTokens,
    remainingTokens: Math.max(0, view.limits.dailyTokens - usedTokens - heldTokens),
    remainingRequests: view.limits.dailyRequests === UNLIMITED_DAILY_REQUESTS ? null : Math.max(0, view.limits.dailyRequests - count(view.usage.requests)),
    remainingCost: Math.max(0, view.limits.dailyCostMicros - count(view.usage.costMicros) - count(view.usage.reservedCostMicros)),
    reset: new Date(view.resetsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
  };
}
