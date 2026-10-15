/**
 * The session allowance of sandbox time, and when a sandbox should sleep.
 *
 * Pure functions over plain records, so the rules are tested without a Durable Object. Time is
 * counted while the container runs, in a rolling window - five hours by default, as in a Claude
 * Max plan and like the free AI credits - that opens when the sandbox first runs and refills
 * when it ends. Nobody loses half an allowance by starting late in a day.
 */

export interface Usage {
  /** When the current window opened, epoch milliseconds. */
  readonly windowStart?: number;
  /** Records from before windows carried the UTC day instead; they count as an ended window. */
  readonly day?: string;
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

export const DEFAULT_WINDOW_MS = 5 * 3_600_000;

function live(usage: Usage, now: number, windowMs: number): boolean {
  return usage.windowStart !== undefined && now < usage.windowStart + windowMs;
}

/** Running time just counted; the first running minute after a window ends opens a new one. */
export function addUsage(usage: Usage, now: number, deltaMs: number, windowMs = DEFAULT_WINDOW_MS): Usage {
  const delta = Math.max(0, deltaMs);
  if (live(usage, now, windowMs)) return { windowStart: usage.windowStart!, usedMs: usage.usedMs + delta };
  return { windowStart: now - delta, usedMs: delta };
}

export function usedMs(usage: Usage, now: number, windowMs = DEFAULT_WINDOW_MS): number {
  return live(usage, now, windowMs) ? usage.usedMs : 0;
}

export function remainingMs(usage: Usage, now: number, allowanceMs: number, windowMs = DEFAULT_WINDOW_MS): number {
  return Math.max(0, allowanceMs - usedMs(usage, now, windowMs));
}

/** When the time refills: the open window's end, or a full window from now if none is open. */
export function nextReset(usage: Usage, now: number, windowMs = DEFAULT_WINDOW_MS): number {
  return live(usage, now, windowMs) ? usage.windowStart! + windowMs : now + windowMs;
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
