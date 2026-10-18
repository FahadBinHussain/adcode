import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { COST_PER_MINUTE_USD, type BudgetState } from "../src/budget.ts";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: DurableObjectState, protected env: Env) {}
  },
}));

import { BudgetObject } from "../src/budgetObject.ts";

function fixture(spentUsd: number) {
  let state: BudgetState = { month: "2026-10", spentUsd, running: { person: Date.now() } };
  const ctx = { storage: {
    get: vi.fn(async () => state),
    put: vi.fn(async (_key: string, next: BudgetState) => { state = next; }),
  } } as unknown as DurableObjectState;
  const env = { MONTHLY_CAP_USD: "20", MAX_INSTANCES: "20" } as unknown as Env;
  return new BudgetObject(ctx, env);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the live monthly budget", () => {
  it("tells a running session to pause on the charge that crosses the cap", async () => {
    const budget = fixture(20 - COST_PER_MINUTE_USD / 2);
    expect(await budget.charge("person", 1)).toEqual({ full: true });
    expect(await budget.admit("person")).toEqual({ ok: false, reason: "full" });
    expect((await budget.stats()).spentUsd).toBeGreaterThanOrEqual(20);
  });

  it("lets an existing session continue when a new UTC month opens", async () => {
    const budget = fixture(20);
    expect(await budget.charge("person", 0)).toEqual({ full: true });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(await budget.stats()).toMatchObject({ month: "2026-11", spentUsd: 0, running: 0 });
    expect(await budget.charge("person", 1)).toEqual({ full: false });
    expect(await budget.admit("person")).toEqual({ ok: true });
  });
});
