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
}
