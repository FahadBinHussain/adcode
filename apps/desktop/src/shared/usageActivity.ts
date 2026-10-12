/** A calendar of actual AI requests. Dates are local day keys, not 24-hour intervals. */
export interface UsageActivityDay {
  readonly day: string;
  readonly requests: number;
  readonly tokens: number;
}

export interface UsageActivityView {
  readonly days: readonly UsageActivityDay[];
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly activeDays: number;
}

const DAY = 86_400_000;

function calendarTime(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

/** Moving by calendar dates avoids duplicated or skipped days across daylight saving. */
export function shiftDay(day: string, amount: number): string {
  const time = calendarTime(day);
  if (time === null) throw new RangeError("Invalid calendar day");
  return new Date(time + amount * DAY).toISOString().slice(0, 10);
}

/** Past 365 days; today's unfinished day does not break yesterday's streak. */
export function usageActivity(rows: readonly UsageActivityDay[], today: string): UsageActivityView {
  const first = shiftDay(today, -364);
  const byDay = new Map<string, { requests: number; tokens: number }>();
  for (const row of rows) {
    if (calendarTime(row.day) === null || row.day < first || row.day > today) continue;
    const prior = byDay.get(row.day) ?? { requests: 0, tokens: 0 };
    prior.requests += Number.isFinite(row.requests) ? Math.max(0, row.requests) : 0;
    prior.tokens += Number.isFinite(row.tokens) ? Math.max(0, row.tokens) : 0;
    byDay.set(row.day, prior);
  }
  const days = Array.from({ length: 365 }, (_, index) => {
    const day = shiftDay(first, index);
    return { day, ...(byDay.get(day) ?? { requests: 0, tokens: 0 }) };
  });
  let longestStreak = 0;
  let run = 0;
  let activeDays = 0;
  for (const day of days) {
    run = day.requests > 0 ? run + 1 : 0;
    if (run > 0) activeDays += 1;
    longestStreak = Math.max(longestStreak, run);
  }
  let end = days.length - 1;
  if (days[end]!.requests === 0) end -= 1;
  let currentStreak = 0;
  for (; end >= 0 && days[end]!.requests > 0; end -= 1) currentStreak += 1;
  return { days, currentStreak, longestStreak, activeDays };
}
