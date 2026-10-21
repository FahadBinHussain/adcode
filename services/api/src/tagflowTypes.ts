/** Server-owned included AI configuration and accounting; never contains an API key. */
import type { CustomProvider, IncludedProviderId, TagflowLimits } from "./includedProviders.ts";
import type { ModelFeedbackRecord, ModelReportData, ModelReportRange, ModelRequestRecord } from "./tagflowReportTypes.ts";
import type { ModelAudienceProfile } from "./modelAudience.ts";
import type { CreditCharge, CreditPlan, CreditWindows } from "./credits.ts";
import type { PaidConfig } from "./paidTokens.ts";
// Defined beside the providers, which can carry their own allowance, so neither file imports the other.
export type { TagflowLimits } from "./includedProviders.ts";

export interface TagflowModel {
  id: string;
  name: string;
  /** Older records without a provider use Tagflow. */
  provider?: IncludedProviderId;
  /** Optional upstream ID when the public ID is an alias. */
  upstreamModel?: string;
  /** Missing preserves older enabled models. */
  enabled?: boolean;
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens, as quoted by your deployment. */
  inputPrice: number;
  outputPrice: number;
  /** Credits per 1,000 tokens; missing derives one (see credits.ts). Zero is free of credits. */
  creditRate?: number;
}

export interface TagflowConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  models: TagflowModel[];
  limits: TagflowLimits;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Administrator-registered OpenAI-compatible providers; missing means none. */
  providers?: CustomProvider[];
  /** Credits per rolling window; missing uses DEFAULT_CREDIT_PLAN. */
  credits?: CreditPlan;
  /** Paid tokens on some providers' models; missing means none are paid. See paidTokens.ts. */
  paid?: PaidConfig;
}

export interface TagflowConfigRecord {
  config: TagflowConfig;
  updatedAt: number;
  updatedBy: string;
}

export interface TagflowUserPolicy {
  blocked: boolean;
  /** Null inherits the current defaults. */
  limits: TagflowLimits | null;
  /** A personal credit plan; null or missing inherits the default. */
  credits?: CreditPlan | null;
  updatedAt: number;
  updatedBy: string;
}

export interface TagflowUsage {
  uid: string;
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimatedRequests: number;
  reservedTokens: number;
  reservedCostMicros: number;
}

export interface TagflowReservation {
  /** Bypass per-user quotas while preserving atomic usage accounting. */
  unlimited?: boolean;
  id: string;
  uid: string;
  day: string;
  minute: number;
  tokens: number;
  costMicros: number;
  limits: TagflowLimits;
  /** The account's credit windows to check and hold; missing charges no credits. */
  credits?: CreditCharge;
}

export interface TagflowSettlement {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
  /** Only a definite upstream refusal releases the request itself. */
  failed: boolean;
  /** Credits actually used, in millicredits. */
  millicredits?: number;
}

export type TagflowReserveResult = "ok" | "daily-limit" | "rate-limit" | "session-limit" | "weekly-limit";

export interface TagflowStore {
  getModelAudienceProfile(uid: string): Promise<ModelAudienceProfile | null>;
  putModelAudienceProfile(profile: ModelAudienceProfile): Promise<void>;
  deleteModelAudienceProfile(uid: string): Promise<void>;
  putModelRequest(record: ModelRequestRecord): Promise<void>;
  getModelRequest(id: string): Promise<ModelRequestRecord | null>;
  putModelFeedback(record: ModelFeedbackRecord): Promise<void>;
  getModelFeedback(requestId: string, uid: string): Promise<ModelFeedbackRecord | null>;
  deleteModelFeedback(requestId: string, uid: string): Promise<void>;
  readModelReports(range: ModelReportRange): Promise<ModelReportData>;
  getTagflowConfig(): Promise<TagflowConfigRecord | null>;
  putTagflowConfig(record: TagflowConfigRecord): Promise<void>;
  getTagflowPolicy(uid: string): Promise<TagflowUserPolicy | null>;
  putTagflowPolicy(uid: string, policy: TagflowUserPolicy): Promise<void>;
  getTagflowUsage(uid: string, day: string): Promise<TagflowUsage | null>;
  listTagflowUsage(day: string): Promise<TagflowUsage[]>;
  /** Atomic across all workers: reserves a request and its maximum token/cost budget. */
  reserveTagflow(request: TagflowReservation): Promise<TagflowReserveResult>;
  /** The account's credit windows as stored; an ended window is still returned. */
  getCreditWindows(uid: string): Promise<CreditWindows>;
  /** Atomic and idempotent. A failed settlement leaves its reservation charged. */
  settleTagflow(id: string, usage: TagflowSettlement): Promise<void>;
  /**
   * Claims the right to send this account one verification email: true when it has never had one
   * from the included-AI gate, or its last one is at least `gapMs` old. Atomic across workers.
   */
  claimVerificationSend(uid: string, now: number, gapMs: number): Promise<boolean>;
}
