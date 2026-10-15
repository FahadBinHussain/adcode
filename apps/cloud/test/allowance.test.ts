/*
 * The session allowance and when a sandbox sleeps.
 *
 * Each person gets a fixed amount of running sandbox time per rolling window (five hours by
 * default), opened by the first running minute. A sandbox sleeps when nobody is using it - no
 * tab, or a tab nobody has touched - unless an agent is still working, because stopping an
 * agent mid-task to save a minute would waste the minutes already spent.
 */
import { describe, expect, it } from "vitest";
import { addUsage, nextReset, remainingMs, shouldSleep, usedMs } from "../src/allowance.ts";

const NOON = Date.UTC(2026, 9, 14, 12, 0, 0);
const MINUTE = 60_000;
const WINDOW = 5 * 60 * MINUTE;

describe("usage", () => {
  it("opens a window with the first running minute and adds time inside it", () => {
    const opened = addUsage({ usedMs: 0 }, NOON, MINUTE);
    expect(opened).toEqual({ windowStart: NOON - MINUTE, usedMs: MINUTE });
    expect(addUsage(opened, NOON + 4 * 60 * MINUTE, 5 * MINUTE)).toEqual({ windowStart: NOON - MINUTE, usedMs: 6 * MINUTE });
  });

  it("starts again in a new window once five hours have passed, whatever the clock day", () => {
    const later = NOON + WINDOW;
    expect(addUsage({ windowStart: NOON, usedMs: 59 * MINUTE }, later, 2 * MINUTE)).toEqual({ windowStart: later - 2 * MINUTE, usedMs: 2 * MINUTE });
  });

  it("never goes below nothing left, and an ended window does not count", () => {
    expect(remainingMs({ windowStart: NOON, usedMs: 70 * MINUTE }, NOON + MINUTE, 60 * MINUTE)).toBe(0);
    expect(remainingMs({ windowStart: NOON - WINDOW, usedMs: 60 * MINUTE }, NOON, 60 * MINUTE)).toBe(60 * MINUTE);
    // Records from before windows carried a day and count as ended.
    expect(usedMs({ day: "2026-10-14", usedMs: 60 * MINUTE }, NOON)).toBe(0);
  });

  it("refills when the open window ends, or a full window from now when none is open", () => {
    expect(nextReset({ windowStart: NOON, usedMs: MINUTE }, NOON + MINUTE)).toBe(NOON + WINDOW);
    expect(nextReset({ usedMs: 0 }, NOON)).toBe(NOON + WINDOW);
    expect(nextReset({ windowStart: NOON, usedMs: MINUTE }, NOON + 2 * WINDOW, 3 * 60 * MINUTE)).toBe(NOON + 2 * WINDOW + 3 * 60 * MINUTE);
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
