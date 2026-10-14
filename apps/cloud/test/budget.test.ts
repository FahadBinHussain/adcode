/*
 * The monthly cap and the cap on sandboxes running at once.
 *
 * The bill's safety net: whatever the daily allowances add up to, the month stops at the cap,
 * and only so many containers run at once. Spend is estimated on the worst case - provisioned
 * memory and disk, and the full vCPU - so the real bill can only be lower.
 */
import { describe, expect, it } from "vitest";
import { COST_PER_MINUTE_USD, admit, charge, release, type BudgetState } from "../src/budget.ts";

const OCT = Date.UTC(2026, 9, 14, 12, 0, 0);
const NOV = Date.UTC(2026, 10, 1, 0, 1, 0);
const empty = (month = "2026-10"): BudgetState => ({ month, spentUsd: 0, running: {} });

describe("budget", () => {
  it("prices a running minute at the worst case for standard-1", () => {
    // 4 GiB x 60 s x $0.0000025 + 8 GB x 60 s x $0.00000007 + 0.5 vCPU x 60 s x $0.00002
    expect(COST_PER_MINUTE_USD).toBeCloseTo(0.0006 + 0.0000336 + 0.0006, 10);
  });

  it("admits someone while there is room, and remembers them as running", () => {
    const result = admit(empty(), "u1", OCT, { capUsd: 20, maxInstances: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.state.running)).toEqual(["u1"]);
  });

  it("says full when the month's cap is reached", () => {
    const state = { ...empty(), spentUsd: 20 };
    expect(admit(state, "u1", OCT, { capUsd: 20, maxInstances: 5 })).toEqual({ ok: false, reason: "full" });
  });

  it("says busy when every slot is taken, unless this person already has one", () => {
    const state: BudgetState = { ...empty(), running: { a: OCT, b: OCT } };
    expect(admit(state, "c", OCT, { capUsd: 20, maxInstances: 2 })).toEqual({ ok: false, reason: "busy" });
    expect(admit(state, "a", OCT, { capUsd: 20, maxInstances: 2 }).ok).toBe(true);
  });

  it("forgets a slot nobody has charged against for ten minutes, so a crashed session cannot hold one forever", () => {
    const state: BudgetState = { ...empty(), running: { a: OCT - 11 * 60_000, b: OCT } };
    expect(admit(state, "c", OCT, { capUsd: 20, maxInstances: 2 }).ok).toBe(true);
  });

  it("adds charges and starts a new month from zero", () => {
    const charged = charge({ ...empty(), running: { u1: OCT } }, "u1", 10, OCT);
    expect(charged.spentUsd).toBeCloseTo(10 * COST_PER_MINUTE_USD, 10);
    expect(charge(charged, "u1", 1, NOV)).toMatchObject({ month: "2026-11", spentUsd: COST_PER_MINUTE_USD });
  });

  it("frees the slot when someone's sandbox stops", () => {
    expect(release({ ...empty(), running: { u1: OCT, u2: OCT } }, "u1").running).toEqual({ u2: OCT });
  });
});
