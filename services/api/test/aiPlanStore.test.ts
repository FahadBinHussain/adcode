import { describe, expect, it } from "vitest";
import { createTagflowMemoryStore } from "../src/tagflowMemoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";

const DAY = 86_400_000;
const sub = (over: Record<string, unknown> = {}) => ({ webhookId: "wh1", type: "active" as const, subscriptionId: "sub_1", uid: "u" as string | null, plan: "monthly" as "monthly" | "pro" | "weekly" | null, customerId: "cus_1", status: "active", periodEnd: 30 * DAY, cancelAtPeriodEnd: false, now: DAY, ...over });

describe("AI plans in the memory store", () => {
  it("applies a subscription once and reports the plan until its period ends", async () => {
    const store = createTagflowMemoryStore();
    expect(await store.applySubscriptionEvent(sub())).toBe("applied");
    expect(await store.applySubscriptionEvent(sub())).toBe("duplicate");
    expect((await store.getAiPlanState("u", 2 * DAY)).plan).toMatchObject({ id: "monthly", source: "subscription" });
    expect((await store.getAiPlanState("u", 31 * DAY)).plan).toBeNull();
    expect(await store.getSubscription("u")).toMatchObject({ customerId: "cus_1", plan: "monthly" });
  });

  it("keeps a cancelled plan until the period ends, and ends a failed one at once", async () => {
    const store = createTagflowMemoryStore();
    await store.applySubscriptionEvent(sub());
    await store.applySubscriptionEvent(sub({ webhookId: "wh2", type: "cancelled", status: "cancelled", cancelAtPeriodEnd: true, now: 2 * DAY }));
    expect((await store.getAiPlanState("u", 3 * DAY)).plan?.id).toBe("monthly");
    await store.applySubscriptionEvent(sub({ webhookId: "wh3", type: "failed", status: "failed", now: 4 * DAY }));
    expect((await store.getAiPlanState("u", 5 * DAY)).plan).toBeNull();
  });

  it("sends a subscription with no uid or no plan to review", async () => {
    const store = createTagflowMemoryStore();
    expect(await store.applySubscriptionEvent(sub({ uid: null }))).toBe("review");
    expect(await store.applySubscriptionEvent(sub({ webhookId: "wh9", plan: null }))).toBe("review");
  });

  it("gifts and boosts one person or everyone, and the best one wins", async () => {
    const store = createTagflowMemoryStore();
    await store.giftPlan("*", "weekly", 7, "admin", "launch", 0);
    await store.boostAllowance("u", 90_000_000, 3 * DAY, "admin", "sorry", 0);
    expect(await store.getAiPlanState("other", DAY)).toMatchObject({ plan: { id: "weekly", source: "gift" }, boostTokens: 0 });
    expect(await store.getAiPlanState("u", DAY)).toMatchObject({ plan: { id: "weekly" }, boostTokens: 90_000_000 });
    expect((await store.getAiPlanState("u", 8 * DAY)).plan).toBeNull();
    expect((await store.getAiPlanState("u", 8 * DAY)).boostTokens).toBe(0);
  });

  it("redeems a promo once per account and stops at its limit", async () => {
    const store = createTagflowMemoryStore();
    expect(await store.createPromo({ code: "ONE", kind: "tokens", tokens: 5, maxRedemptions: 1, expiresAt: 10 * DAY }, "admin", 0)).toBe(true);
    expect(await store.createPromo({ code: "ONE", kind: "tokens", tokens: 5, maxRedemptions: 1, expiresAt: 10 * DAY }, "admin", 0)).toBe(false);
    expect(await store.redeemPromo("ONE", "a", DAY)).toBe("tokens");
    expect(await store.redeemPromo("ONE", "a", DAY)).toBe("already");
    expect(await store.redeemPromo("ONE", "b", DAY)).toBe("used-up");
    expect(await store.redeemPromo("NOPE", "b", DAY)).toBe("unknown");
    expect((await store.getPaidTokens("a")).balance.purchased).toBe(5);
    await store.createPromo({ code: "PRO7", kind: "plan", plan: "pro", days: 7, maxRedemptions: 5, expiresAt: 3 * DAY }, "admin", 0);
    expect(await store.redeemPromo("PRO7", "c", 4 * DAY)).toBe("expired");
    expect(await store.redeemPromo("PRO7", "d", DAY)).toBe("plan");
    expect((await store.getAiPlanState("d", 2 * DAY)).plan).toMatchObject({ id: "pro", source: "gift" });
    expect((await store.listPromos()).find((p) => p.code === "PRO7")?.redemptions).toBe(1);
  });

  it("rewards a pro invite once, when the invitee first subscribes", async () => {
    const store = createTagflowMemoryStore();
    await store.applySubscriptionEvent(sub({ uid: "pro1", plan: "pro", subscriptionId: "sub_p", webhookId: "whp" }));
    const invite = (await store.getInvite("pro1", DAY))!;
    expect(invite).toMatchObject({ uses: 0, maxUses: 2 });
    expect((await store.getInvite("pro1", DAY))!.code).toBe(invite.code);
    expect(await store.redeemInvite(invite.code, "pro1", DAY)).toBe("own-code");
    expect(await store.redeemInvite(invite.code, "friend", DAY)).toBe("joined");
    expect(await store.redeemInvite(invite.code, "friend", DAY)).toBe("already");
    await store.applySubscriptionEvent(sub({ uid: "friend", subscriptionId: "sub_f", webhookId: "whf1" }));
    await store.applySubscriptionEvent(sub({ uid: "friend", subscriptionId: "sub_f2", webhookId: "whf2" }));
    expect((await store.getPaidTokens("friend")).balance.purchased).toBe(4_000_000);
    expect((await store.getPaidTokens("pro1")).balance.purchased).toBe(4_000_000);
    expect(await store.getInvite("nopro", DAY)).toBeNull();
    expect(await store.redeemInvite(invite.code, "has-sub", DAY)).toBe("joined");
    expect(await store.redeemInvite(invite.code, "third", DAY)).toBe("used-up");
  });

  it("will not make a subscriber someone's invitee", async () => {
    const store = createTagflowMemoryStore();
    await store.applySubscriptionEvent(sub({ uid: "pro1", plan: "pro", subscriptionId: "sub_p", webhookId: "whp" }));
    await store.applySubscriptionEvent(sub({ uid: "paying", subscriptionId: "sub_x", webhookId: "whx" }));
    const invite = (await store.getInvite("pro1", DAY))!;
    expect(await store.redeemInvite(invite.code, "paying", DAY)).toBe("has-plan");
  });

  it("resets a week only when nothing is held in it", async () => {
    const store = createTagflowMemoryStore();
    expect(await store.resetAiWeek("u")).toBe("none");
    await store.reserveTagflow({ unlimited: true, id: "r1", uid: "u", day: "2026-10-24", minute: 1, tokens: 10, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits, paid: { freeWeeklyTokens: 100, now: 1 } });
    expect(await store.resetAiWeek("u")).toBe("busy");
    await store.settleTagflow("r1", { inputTokens: 10, outputTokens: 0, costMicros: 0, estimated: false, failed: false });
    expect(await store.listPaidWeekUids("", 10)).toEqual(["u"]);
    expect(await store.resetAiWeek("u")).toBe("reset");
    expect((await store.getPaidTokens("u")).free).toBeNull();
  });

  it("sums active subscriptions by plan", async () => {
    const store = createTagflowMemoryStore();
    await store.applySubscriptionEvent(sub());
    await store.applySubscriptionEvent(sub({ uid: "v", subscriptionId: "sub_2", webhookId: "w2", plan: "pro" }));
    expect(await store.subscriptionSummary(2 * DAY)).toEqual([{ plan: "monthly", active: 1, mrrCents: 900 }, { plan: "pro", active: 1, mrrCents: 1900 }]);
  });
});
