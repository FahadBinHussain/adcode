/** Server-owned included AI configuration and accounting; never contains an API key. */
import type { IncludedProviderId } from "./includedProviders.ts";
import type { ModelFeedbackRecord, ModelReportData, ModelReportRange, ModelRequestRecord } from "./tagflowReportTypes.ts";
import type { ModelAudienceProfile } from "./modelAudience.ts";
export interface TagflowLimits {
  dailyRequests: number;
  dailyTokens: number;
  dailyCostMicros: number;
  requestsPerMinute: number;
}

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
}

export interface TagflowConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  models: TagflowModel[];
  limits: TagflowLimits;
  maxInputTokens: number;
  maxOutputTokens: number;
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
  id: string;
  uid: string;
  day: string;
  minute: number;
  tokens: number;
  costMicros: number;
  limits: TagflowLimits;
}

export interface TagflowSettlement {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
  /** Only a definite upstream refusal releases the request itself. */
  failed: boolean;
}

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
  reserveTagflow(request: TagflowReservation): Promise<"ok" | "daily-limit" | "rate-limit">;
  /** Atomic and idempotent. A failed settlement leaves its reservation charged. */
  settleTagflow(id: string, usage: TagflowSettlement): Promise<void>;
}
