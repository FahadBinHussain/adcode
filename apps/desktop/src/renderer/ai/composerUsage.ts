import type { AiUsageView } from "../../shared/aiUsage.ts";
import { formatUsageCost } from "../../shared/aiUsage.ts";
import { allowanceForModel, type TagflowAllowanceView } from "../../shared/tagflow.ts";
import { createComposerMeter, type ComposerMeterModel } from "./composerMeter.ts";
import { formatTokens } from "./contextMeter.ts";
import { allowanceSummary } from "./allowanceSummary.ts";

const unknown = (detail: string, tooltip: string): ComposerMeterModel => ({ percent: null, value: "—", detail, tooltip, tone: "unknown" });
const count = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
const percent = (used: number, limit: number): number => limit <= 0 || count(used) >= limit ? 100 : Math.min(99, Math.round(count(used) / limit * 100));
const tone = (value: number): "ok" | "warn" | "full" => value >= 100 ? "full" : value >= 80 ? "warn" : "ok";

/**
 * Included quotas are shared across devices. A partner model with its own allowance shows that
 * one instead of the main allowance. Other providers expose counts, without a quota.
 */
export function composerUsageModels(view: AiUsageView | null, allowance: TagflowAllowanceView | null, included: boolean, modelId: string | null = null): readonly [ComposerMeterModel, ComposerMeterModel] {
  if (included) {
    if (allowance === null || !allowance.available) {
      const unavailable = unknown("Unavailable", "Included AI allowance could not be checked. Open AI usage to retry.");
      return [unavailable, unavailable];
    }
    if (allowance.blocked) {
      const blocked: ComposerMeterModel = { percent: null, value: "!", detail: "Disabled", tone: "full", tooltip: "Included AI is disabled for this account. Open AI usage for details." };
      return [blocked, blocked];
    }
    const scoped = allowanceForModel(allowance, modelId);
    const { usage, limits } = scoped;
    const pool = scoped.poolName === null ? "" : `${scoped.poolName} models have their own daily allowance, separate from other free models. `;
    const tokens = count(usage.inputTokens) + count(usage.outputTokens) + count(usage.reservedTokens);
    const cost = count(usage.costMicros) + count(usage.reservedCostMicros);
    const tokenPercent = percent(tokens, limits.dailyTokens);
    const costPercent = percent(cost, limits.dailyCostMicros);
    const summary = allowanceSummary(scoped);
    const remaining = summary.remainingCost === 0 ? "Budget reached" : `${formatTokens(summary.remainingTokens)} left`;
    const reset = `Resets ${summary.reset}. Shared across devices; active replies temporarily hold ${formatTokens(summary.heldTokens)} tokens.`;
    const requestPercent = percent(usage.requests, limits.dailyRequests);
    return [
      { percent: tokenPercent, value: `${tokenPercent}%`, detail: remaining, tone: tone(Math.max(tokenPercent, costPercent)), tooltip: `${pool}${tokenPercent}% of today's included AI tokens used or held for active replies. ${summary.remainingTokens.toLocaleString()} tokens left out of ${limits.dailyTokens.toLocaleString()}. ${count(usage.inputTokens).toLocaleString()} input (read), ${count(usage.outputTokens).toLocaleString()} output (written). Each AI step counts the history and tool results it reads again. Service budget: ${formatUsageCost(summary.remainingCost)} left of ${formatUsageCost(limits.dailyCostMicros)}; ADCode pays this cost. ${reset} Open AI usage for details.` },
      summary.remainingRequests === null
        ? { percent: null, value: "∞", detail: "Unlimited", tone: "ok", tooltip: `${count(usage.requests).toLocaleString()} included AI requests used today. No daily request cap in ADCode. Your daily token allowance and provider limits still apply. Open AI usage for details.` }
        : { percent: requestPercent, value: `${requestPercent}%`, detail: `${summary.remainingRequests.toLocaleString()} left`, tone: tone(requestPercent), tooltip: `${count(usage.requests).toLocaleString()} of ${limits.dailyRequests.toLocaleString()} included AI requests used today. ${reset} Open AI usage for details.` },
    ];
  }
  if (view === null) {
    const unavailable = unknown("Unavailable", "Today's usage could not be read. Open AI usage to retry.");
    return [unavailable, unavailable];
  }
  const { totals } = view;
  const tokens = count(totals.inputTokens) + count(totals.outputTokens);
  return [
    unknown(`${totals.estimated ? "≈ " : ""}${formatTokens(tokens)} today`, `${formatTokens(tokens)} tokens used on this computer today, across chat and agents${totals.estimated ? "; some counts are estimated" : ""}. This provider does not report an account limit. Open AI usage for details.`),
    { ...unknown("Today", `${totals.requests.toLocaleString()} AI requests on this computer today, across chat and agents. This provider does not report an account limit. Open AI usage for details.`), value: formatTokens(totals.requests) },
  ];
}

interface UsageApi {
  read(range: "today"): Promise<AiUsageView>;
  allowance(): Promise<TagflowAllowanceView | null>;
  onChanged(listener: () => void): () => void;
}

/** Poll only while the composer is visible; coalesce requests and discard obsolete results. */
export function createComposerUsage(api: UsageApi, onOpen: () => void) {
  const usage = createComposerMeter("Tokens used", onOpen);
  const requests = createComposerMeter("Requests", onOpen);
  usage.element.dataset["meter"] = "usage";
  requests.element.dataset["meter"] = "requests";
  for (const meter of [usage, requests]) meter.element.setAttribute("aria-haspopup", "dialog");
  let included = false;
  let includedModel: string | null = null;
  let visible = false;
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<void> | null = null;
  let again = false;
  const checking = (): void => {
    for (const meter of [usage, requests]) meter.update(unknown("Checking…", "Checking today's AI usage."));
  };
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending !== null) { again = true; return pending; }
    const mine = generation;
    pending = (async () => {
      const [history, allowance] = await Promise.allSettled([api.read("today"), included ? api.allowance() : Promise.resolve(null)]);
      if (disposed || mine !== generation) return;
      const models = composerUsageModels(history.status === "fulfilled" ? history.value : null, allowance.status === "fulfilled" ? allowance.value : null, included, includedModel);
      usage.update(models[0]);
      requests.update(models[1]);
    })().finally(() => {
      pending = null;
      if (again && !disposed) { again = false; void refresh(); }
    });
    return pending;
  }
  const stop = api.onChanged(() => { if (visible) void refresh(); });
  return {
    elements: [usage.element, requests.element] as const,
    refresh,
    setIncluded(next: boolean, model: string | null = null): void {
      if (next === included && model === includedModel) return;
      included = next;
      includedModel = model;
      generation += 1;
      checking();
      void refresh();
    },
    setVisible(next: boolean): void {
      if (next === visible) return;
      visible = next;
      clearInterval(timer);
      timer = undefined;
      if (!next) return;
      void refresh();
      timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      clearInterval(timer);
      stop();
    },
  };
}
