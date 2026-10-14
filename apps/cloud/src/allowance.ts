/**
 * The daily allowance of sandbox time, and when a sandbox should sleep.
 *
 * Pure functions over plain records, so the rules are tested without a Durable Object. Time is
 * counted while the container runs; it resets at UTC midnight.
 */

export interface Usage {
  /** The UTC day this count belongs to, `yyyy-mm-dd`. */
  readonly day: string;
  readonly usedMs: number;
}

export interface Activity {
  /** Tabs connected right now. */
  readonly connections: number;
  /** An agent turn, a team or an automation is running. */
  readonly busy: boolean;
  /** The last time someone touched a connected tab, epoch milliseconds. */
  readonly lastInputAt: number;
  /** When the last tab closed, or null while one is connected. */
  readonly idleSince: number | null;
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function nextReset(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function addUsage(usage: Usage, now: number, deltaMs: number): Usage {
  const today = dayKey(now);
  const base = usage.day === today ? usage.usedMs : 0;
  return { day: today, usedMs: base + Math.max(0, deltaMs) };
}

export function remainingMs(usage: Usage, now: number, allowanceMs: number): number {
  const used = usage.day === dayKey(now) ? usage.usedMs : 0;
  return Math.max(0, allowanceMs - used);
}

/**
 * Sleep when nobody is using the sandbox: no tab for `idleMs`, or a tab nobody has touched for
 * `untouchedMs`. Never while something is working - stopping an agent mid-task to save a minute
 * would waste the minutes it already spent.
 */
export function shouldSleep(activity: Activity, now: number, config: { idleMs: number; untouchedMs: number }): boolean {
  if (activity.busy) return false;
  if (activity.connections > 0) return now - activity.lastInputAt >= config.untouchedMs;
  return activity.idleSince !== null && now - activity.idleSince >= config.idleMs;
}
