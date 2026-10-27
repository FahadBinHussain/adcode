import { parsePaidConfig } from "@adcode/api/src/paidTokens.ts";
import { readApi } from "./apiRead";
import { STANDARD_PRICING, type PricingOffer } from "./pricing";

/** Source catalogue is always renderable; successful live changes are cached for one minute. */
export async function pricingOffer(): Promise<PricingOffer> {
  try {
    const response = await readApi("/v1/ai/tagflow/config", 60);
    if (!response.ok) return STANDARD_PRICING;
    const raw: unknown = await response.json();
    if (typeof raw !== "object" || raw === null || !("paid" in raw) || typeof raw.paid !== "object" || raw.paid === null) return STANDARD_PRICING;
    const paid = raw.paid as Record<string, unknown>;
    const config = parsePaidConfig({ enabled: paid["enabled"], providers: paid["providers"], freeWeeklyTokens: paid["freeWeeklyTokens"], packs: paid["packs"] });
    return config === null ? STANDARD_PRICING : { freeWeeklyTokens: config.freeWeeklyTokens, packs: config.packs, available: config.enabled };
  } catch {
    return STANDARD_PRICING;
  }
}
