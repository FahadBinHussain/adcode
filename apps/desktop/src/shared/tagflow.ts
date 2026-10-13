// Numeric encodings shared with the relay and database; zero remains disabled.
export const UNLIMITED_DAILY_REQUESTS = 1_000_000;
export const UNLIMITED_REQUESTS_PER_MINUTE = 1000;
export const AUDIENCE_ROLES = ["unknown", "student", "hobbyist", "professional-developer", "founder", "designer", "researcher", "other"] as const;
export const AUDIENCE_EXPERIENCE = ["unknown", "beginner", "intermediate", "advanced"] as const;
export const DECLARED_USES = ["unknown", "build-product", "debugging", "testing", "code-review", "learning", "documentation", "ui-design", "other"] as const;
export interface TagflowAudienceInput { role: typeof AUDIENCE_ROLES[number]; experience: typeof AUDIENCE_EXPERIENCE[number]; primaryUse: typeof DECLARED_USES[number]; consent: boolean }
export type TagflowAudienceResult = { ok: true; profile: TagflowAudienceInput | null } | { ok: false; message: string };
/** Only a fixed starter category is reported, never a custom agent name or instructions. */
export function includedAiPersona(source: string, roleId?: string): string {
  if (source === "chat") return "coding-assistant";
  if (source === "edit" || source === "completion") return "inline-assistant";
  if (source !== "agent") return "unknown";
  if (roleId === "default-agent") return "coding-assistant";
  return new Map([["starter-reviewer","reviewer"], ["starter-tester","tester"], ["starter-ui-polish","ui-polish"], ["starter-bug-fixer","bug-fixer"], ["starter-docs-writer","docs-writer"]]).get(roleId ?? "") ?? "custom-agent";
}

export interface TagflowFeedbackInput {
  requestId: string;
  rating: "helpful" | "not-helpful" | null;
  category: "quality" | "instructions" | "tools" | "speed" | "reliability" | "other";
  comment: string;
  shareWithProvider: boolean;
}
export type TagflowFeedbackResult = { ok: true } | { ok: false; message: string };

/** Included AI's account-wide allowance, separate from this machine's usage history. */
export interface TagflowAllowanceView {
  available: boolean;
  blocked: boolean;
  limits: { dailyRequests: number; dailyTokens: number; dailyCostMicros: number; requestsPerMinute: number };
  usage: { day: string; requests: number; inputTokens: number; outputTokens: number; costMicros: number; estimatedRequests: number; reservedTokens: number; reservedCostMicros: number };
  resetsAt: number;
  /** Partner models with their own daily allowance, counted apart from the main one. Older servers omit it. */
  pools?: { provider: string; name: string; models: string[]; limits: TagflowAllowanceView["limits"]; usage: TagflowAllowanceView["usage"] }[];
}

/**
 * Why free AI could not get a sign-in token for a request.
 *
 * A token refresh that fails because the network dropped is not a sign-in problem: called
 * one, a signed-in person mid-task was asked to sign in again. That becomes the same
 * "fetch failed" a dropped request raises, which the turn retries by itself; only a real
 * refusal asks the person to sign in.
 */
export function includedTokenError(detail: string): Error {
  if (/transport failure|fetch failed|socket hang up|E(?:CONN\w+|NOTFOUND|TIMEDOUT|AI_AGAIN|NETUNREACH|HOSTUNREACH)|UND_ERR_|network|timed? ?out/i.test(detail)) {
    const code = /\b(E[A-Z_]{3,}|UND_ERR_[A-Z_]+)\b/.exec(detail)?.[1];
    return Object.assign(new TypeError("fetch failed"), code === undefined ? {} : { cause: Object.assign(new Error(detail), { code }) });
  }
  return new Error("Sign in in Account to use included AI.");
}

/** The allowance a model draws from: its partner's own pool when it has one, otherwise the main allowance. */
export function allowanceForModel(view: TagflowAllowanceView, modelId: string | null): TagflowAllowanceView & { poolName: string | null } {
  const pool = modelId === null ? undefined : view.pools?.find((one) => Array.isArray(one.models) && one.models.includes(modelId));
  return pool === undefined ? { ...view, poolName: null } : { ...view, limits: pool.limits, usage: pool.usage, poolName: pool.name };
}
