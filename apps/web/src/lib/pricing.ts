import { INVITE_REWARD_TOKENS, PLANS } from "@adcode/api/src/aiPlans.ts";
import { DEFAULT_PAID_CONFIG, type PaidPack } from "@adcode/api/src/paidTokens.ts";

export { INVITE_REWARD_TOKENS, PLANS };
export const FREE_WEEKLY_TOKENS = DEFAULT_PAID_CONFIG.freeWeeklyTokens;
export const tokenAmount = (tokens: number): string => `${Number((tokens / 1_000_000).toFixed(2))}M`;
export const price = (cents: number): string => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
export const PLAN_SUMMARY = PLANS.map(plan => `${plan.name} ${price(plan.priceCents)}/${plan.interval} for ${tokenAmount(plan.weeklyTokens)}/week`).join(", ");
export const PACK_SUMMARY = DEFAULT_PAID_CONFIG.packs.map(pack => `${price(pack.priceCents)} for ${tokenAmount(pack.tokens)}`).join(", ");

export interface PricingOffer {
  readonly freeWeeklyTokens: number;
  readonly packs: readonly PaidPack[];
  /** Null means the current sale configuration could not be checked. */
  readonly available: boolean | null;
}

export const STANDARD_PRICING: PricingOffer = {
  freeWeeklyTokens: FREE_WEEKLY_TOKENS,
  packs: DEFAULT_PAID_CONFIG.packs,
  available: null,
};
