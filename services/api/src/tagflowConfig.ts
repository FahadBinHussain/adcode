import type { TagflowConfig, TagflowLimits, TagflowModel } from "./tagflowTypes.ts";
import { INCLUDED_PROVIDERS, modelProvider, type IncludedProviderId } from "./includedProviders.ts";

// Keep the existing numeric wire format compatible with deployed relays.
// These reserved values disable request-count checks; zero still blocks usage.
export const UNLIMITED_DAILY_REQUESTS = 1_000_000;
export const UNLIMITED_REQUESTS_PER_MINUTE = 1000;

export const DEFAULT_TAGFLOW_CONFIG: TagflowConfig = {
  enabled: false, baseUrl: "", defaultModel: "", models: [],
  limits: { dailyRequests: UNLIMITED_DAILY_REQUESTS, dailyTokens: 1_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: UNLIMITED_REQUESTS_PER_MINUTE },
  maxInputTokens: 262_144, maxOutputTokens: 4096,
};

const record = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const integer = (raw: unknown, max = 1_000_000_000): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= max;
const id = (raw: unknown): raw is string => typeof raw === "string" && /^[^\s\u0000-\u001f]{1,200}$/.test(raw);
const price = (raw: unknown): raw is number => typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 10_000;
const fields = (raw: Record<string, unknown>, allowed: string[]): boolean => Object.keys(raw).every((key) => allowed.includes(key));

/** Tagflow's configurable endpoint stays on the authorized Tagflow domain. */
export function isTagflowUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return baseUrl.length <= 500 && url.protocol === "https:" && url.port === "" &&
      !url.username && !url.password && !url.search && !url.hash &&
      (url.hostname === "tagflow-ai.com" || url.hostname.endsWith(".tagflow-ai.com"));
  } catch { return false; }
}

export function parseTagflowLimits(raw: unknown): TagflowLimits | null {
  if (!record(raw) || !fields(raw, ["dailyRequests", "dailyTokens", "dailyCostMicros", "requestsPerMinute"])) return null;
  const { dailyRequests, dailyTokens, dailyCostMicros, requestsPerMinute } = raw;
  if (!integer(dailyRequests, UNLIMITED_DAILY_REQUESTS) || !integer(dailyTokens) || !integer(dailyCostMicros) || !integer(requestsPerMinute, UNLIMITED_REQUESTS_PER_MINUTE)) return null;
  return { dailyRequests, dailyTokens, dailyCostMicros, requestsPerMinute };
}

export function parseTagflowConfig(raw: unknown): TagflowConfig | null {
  if (!record(raw) || !fields(raw, ["enabled", "baseUrl", "defaultModel", "models", "limits", "maxInputTokens", "maxOutputTokens"])) return null;
  const { enabled, defaultModel, maxInputTokens, maxOutputTokens } = raw;
  if (typeof enabled !== "boolean" || typeof raw["baseUrl"] !== "string" || typeof defaultModel !== "string") return null;
  const baseUrl = raw["baseUrl"].trim().replace(/\/+$/, "");
  if (baseUrl !== "" && !isTagflowUrl(baseUrl)) return null;
  if (!integer(maxInputTokens, 1_000_000) || maxInputTokens < 1 || !integer(maxOutputTokens, 65_536) || maxOutputTokens < 1) return null;
  const limits = parseTagflowLimits(raw["limits"]);
  if (limits === null || !Array.isArray(raw["models"]) || raw["models"].length > 50) return null;
  const models: TagflowModel[] = [];
  for (const item of raw["models"]) {
    if (!record(item) || !fields(item, ["id", "name", "provider", "upstreamModel", "enabled", "contextWindow", "maxOutput", "inputPrice", "outputPrice"])) return null;
    if (item["provider"] !== undefined && !INCLUDED_PROVIDERS.some((provider) => provider.id === item["provider"])) return null;
    if (item["upstreamModel"] !== undefined && !id(item["upstreamModel"])) return null;
    if (item["enabled"] !== undefined && typeof item["enabled"] !== "boolean") return null;
    const { name, contextWindow, maxOutput, inputPrice, outputPrice } = item;
    if (!id(item["id"]) || typeof name !== "string" || !name.trim() || name.length > 120 ||
        !integer(contextWindow, 10_000_000) || contextWindow < 1 || !integer(maxOutput, 65_536) || maxOutput < 1 ||
        maxOutput > contextWindow || !price(inputPrice) || !price(outputPrice) || models.some((one) => one.id === item["id"])) return null;
    models.push({ id: item["id"], name: name.trim(), contextWindow, maxOutput, inputPrice, outputPrice,
      ...(item["provider"] === undefined ? {} : { provider: item["provider"] as IncludedProviderId }),
      ...(item["upstreamModel"] === undefined ? {} : { upstreamModel: item["upstreamModel"] as string }),
      ...(item["enabled"] === undefined ? {} : { enabled: item["enabled"] as boolean }),
    });
  }
  if (defaultModel !== "" && !models.some((model) => model.id === defaultModel && model.enabled !== false)) return null;
  if (enabled && (defaultModel === "" || models.length === 0 || baseUrl === "" && models.some((model) => modelProvider(model) === "tagflow"))) return null;
  return { enabled, baseUrl, defaultModel, models, limits, maxInputTokens, maxOutputTokens };
}

export const tagflowCost = (model: TagflowModel, input: number, output: number): number => Math.ceil(input * model.inputPrice + output * model.outputPrice);
