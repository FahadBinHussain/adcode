import { describe, expect, it } from "vitest";
import { shiftDay, usageActivity } from "../src/shared/usageActivity.ts";

const today = "2026-10-10";
const day = (date: string, requests = 1, tokens = 100) => ({ day: date, requests, tokens });

describe("AI activity calendar", () => {
  it("includes empty days and combines models and sources without counting a day twice", () => {
    const result = usageActivity([day(today, 2), day(today, 3, 200), day("2026-10-08")], today);
    expect(result.days).toHaveLength(365);
    expect(result.days.at(-1)).toEqual(day(today, 5, 300));
    expect(result.days.at(-2)?.requests).toBe(0);
    expect(result.activeDays).toBe(2);
    expect(result.currentStreak).toBe(1);
  });
  it("keeps yesterday's streak until today ends, but breaks it after an inactive day", () => {
    const rows = [day("2026-10-07"), day("2026-10-08"), day("2026-10-09")];
    expect(usageActivity(rows, today).currentStreak).toBe(3);
    expect(usageActivity(rows, "2026-10-11").currentStreak).toBe(0);
  });
  it("finds the longest streak across month and year boundaries", () => {
    const rows = [day("2025-12-30"), day("2025-12-31"), day("2026-01-01"), day("2026-10-09"), day(today)];
    expect(usageActivity(rows, today)).toMatchObject({ longestStreak: 3, currentStreak: 2, activeDays: 5 });
  });
  it("rejects impossible dates, future usage, and use outside the year", () => {
    const result = usageActivity([day("2026-02-30"), day("2026-10-11"), day("2025-01-01"), day(today, 0)], today);
    expect(result).toMatchObject({ longestStreak: 0, currentStreak: 0, activeDays: 0 });
  });
  it("moves calendar dates through daylight-saving changes and leap days", () => {
    expect(shiftDay("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftDay("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(() => shiftDay("2026-02-30", 1)).toThrow(RangeError);
  });
});
