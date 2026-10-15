import { describe, expect, it } from "vitest";
import { admitCredits, creditsView, millicreditsFor, modelCreditRate, parseCreditPlan, settleWindow, untilText, WEEK_MS } from "../src/credits.ts";

const HOUR = 3_600_000;
const limits = { dailyRequests: 1_000_000, dailyTokens: 2_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: 1000 };
const charge = (millicredits: number, now: number) => ({ millicredits, sessionLimit: 2_000, weeklyLimit: 5_000, sessionMs: 5 * HOUR, now });

describe("free AI credits", () => {
  it("opens both windows with the first request and holds what it may use", () => {
    const admitted = admitCredits({ session: null, week: null }, charge(700, 1000));
    expect(admitted).toEqual({ ok: true, windows: {
      session: { startedAt: 1000, endsAt: 1000 + 5 * HOUR, usedMillicredits: 0, reservedMillicredits: 700 },
      week: { startedAt: 1000, endsAt: 1000 + WEEK_MS, usedMillicredits: 0, reservedMillicredits: 700 },
    } });
  });

  it("admits while any credit is left, refuses at the limit, and checks the week first", () => {
    const window = (used: number, startedAt = 0, length = 5 * HOUR) => ({ startedAt, endsAt: startedAt + length, usedMillicredits: used, reservedMillicredits: 0 });
    expect(admitCredits({ session: window(1_999), week: window(1_999, 0, WEEK_MS) }, charge(900, HOUR)).ok).toBe(true);
    expect(admitCredits({ session: window(2_000), week: window(2_000, 0, WEEK_MS) }, charge(1, HOUR))).toEqual({ ok: false, limit: "session-limit" });
    expect(admitCredits({ session: window(2_000), week: window(5_000, 0, WEEK_MS) }, charge(1, HOUR))).toEqual({ ok: false, limit: "weekly-limit" });
    // An ended session window counts as empty; the week does not.
    expect(admitCredits({ session: window(2_000), week: window(4_000, 0, WEEK_MS) }, charge(1, 5 * HOUR)).ok).toBe(true);
    // A free model is never refused.
    expect(admitCredits({ session: window(9_000), week: window(9_000, 0, WEEK_MS) }, charge(0, HOUR)).ok).toBe(true);
  });

  it("settles only into the window a request was held in", () => {
    const current = { startedAt: 10, endsAt: 20, usedMillicredits: 5, reservedMillicredits: 300 };
    expect(settleWindow(current, 10, 300, 120)).toEqual({ ...current, usedMillicredits: 125, reservedMillicredits: 0 });
    expect(settleWindow(current, 1, 300, 120)).toBe(current);
    expect(settleWindow(null, 10, 300, 120)).toBeNull();
  });

  it("prices models: an explicit rate, a partner's old pool, or the standard rate", () => {
    const providers = [{ id: "custom-heabsy" as const, name: "Heabsy", baseUrl: "https://api.heabsy.com/v1", limits: { ...limits, dailyTokens: 10_000_000 } }];
    expect(modelCreditRate({ provider: "custom-heabsy" }, { limits, providers })).toBe(0.2);
    expect(modelCreditRate({ provider: "custom-heabsy", creditRate: 0 }, { limits, providers })).toBe(0);
    expect(modelCreditRate({}, { limits, providers })).toBe(1);
    expect(millicreditsFor(1_000, 1)).toBe(1_000);
    expect(millicreditsFor(1_001, 0.2)).toBe(201);
  });

  it("reports windows in credits, with nothing open before the first request", () => {
    const plan = { sessionCredits: 2, weeklyCredits: 5, sessionHours: 5 };
    expect(creditsView(plan, { session: null, week: null }, {}, 0).session).toEqual({ limit: 2, used: 0, held: 0, remaining: 2, startedAt: null, resetsAt: null });
    const view = creditsView(plan, { session: { startedAt: 0, endsAt: 5 * HOUR, usedMillicredits: 1_500, reservedMillicredits: 400 }, week: null }, {}, HOUR);
    expect(view.session).toEqual({ limit: 2, used: 1.5, held: 0.4, remaining: 0.1, startedAt: 0, resetsAt: 5 * HOUR });
  });

  it("parses plans strictly and words the wait plainly", () => {
    expect(parseCreditPlan({ sessionCredits: 2000, weeklyCredits: 20000, sessionHours: 5 })).not.toBeNull();
    expect(parseCreditPlan({ sessionCredits: 2000, weeklyCredits: 20000, sessionHours: 0 })).toBeNull();
    expect(parseCreditPlan({ sessionCredits: 1.5, weeklyCredits: 20000, sessionHours: 5 })).toBeNull();
    expect(parseCreditPlan({ sessionCredits: 1, weeklyCredits: 1, sessionHours: 5, extra: 1 })).toBeNull();
    expect(untilText(3 * HOUR + 12 * 60_000, 0)).toBe("3 hr 12 min");
    expect(untilText(45 * 60_000, 0)).toBe("45 min");
    expect(untilText(30_000, 0)).toBe("under a minute");
    expect(untilText(2 * 86_400_000 + 3 * HOUR, 0)).toBe("2 days 3 hr");
  });
});
