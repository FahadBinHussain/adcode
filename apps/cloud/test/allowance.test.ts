/*
 * The daily allowance and when a sandbox sleeps.
 *
 * Each person gets a fixed amount of running sandbox time per UTC day. A sandbox sleeps when
 * nobody is using it - no tab, or a tab nobody has touched - unless an agent is still working,
 * because stopping an agent mid-task to save a minute would waste the minutes already spent.
 */
import { describe, expect, it } from "vitest";
import { addUsage, dayKey, nextReset, remainingMs, shouldSleep } from "../src/allowance.ts";

const NOON = Date.UTC(2026, 9, 14, 12, 0, 0);
const MINUTE = 60_000;

describe("usage", () => {
  it("adds running time within a day", () => {
    const usage = addUsage({ day: dayKey(NOON), usedMs: 10 * MINUTE }, NOON, 5 * MINUTE);
    expect(usage).toEqual({ day: "2026-10-14", usedMs: 15 * MINUTE });
  });

  it("starts the count again on a new UTC day", () => {
    const tomorrow = NOON + 24 * 60 * MINUTE;
    expect(addUsage({ day: "2026-10-14", usedMs: 59 * MINUTE }, tomorrow, 2 * MINUTE)).toEqual({ day: "2026-10-15", usedMs: 2 * MINUTE });
  });

  it("never goes below nothing left, and yesterday's use does not count today", () => {
    expect(remainingMs({ day: "2026-10-14", usedMs: 70 * MINUTE }, NOON, 60 * MINUTE)).toBe(0);
    expect(remainingMs({ day: "2026-10-13", usedMs: 60 * MINUTE }, NOON, 60 * MINUTE)).toBe(60 * MINUTE);
  });

  it("resets at the next UTC midnight", () => {
    expect(nextReset(NOON)).toBe(Date.UTC(2026, 9, 15, 0, 0, 0));
  });
});

describe("shouldSleep", () => {
  const config = { idleMs: 5 * MINUTE, untouchedMs: 15 * MINUTE };

  it("stays awake while a tab is open and in use", () => {
    expect(shouldSleep({ connections: 1, busy: false, lastInputAt: NOON - MINUTE, idleSince: null }, NOON, config)).toBe(false);
  });

  it("sleeps an open tab nobody has touched for a while, if nothing is working", () => {
    expect(shouldSleep({ connections: 1, busy: false, lastInputAt: NOON - 16 * MINUTE, idleSince: null }, NOON, config)).toBe(true);
  });

  it("never sleeps while an agent is working, tab or no tab", () => {
    expect(shouldSleep({ connections: 0, busy: true, lastInputAt: NOON - 60 * MINUTE, idleSince: NOON - 60 * MINUTE }, NOON, config)).toBe(false);
    expect(shouldSleep({ connections: 1, busy: true, lastInputAt: NOON - 60 * MINUTE, idleSince: null }, NOON, config)).toBe(false);
  });

  it("sleeps a few minutes after the last tab closed", () => {
    expect(shouldSleep({ connections: 0, busy: false, lastInputAt: NOON - MINUTE, idleSince: NOON - 4 * MINUTE }, NOON, config)).toBe(false);
    expect(shouldSleep({ connections: 0, busy: false, lastInputAt: NOON - MINUTE, idleSince: NOON - 5 * MINUTE }, NOON, config)).toBe(true);
  });
});
