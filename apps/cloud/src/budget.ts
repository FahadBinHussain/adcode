/**
 * The bill's safety net: a monthly spend cap, and a cap on sandboxes running at once.
 *
 * Spend is estimated per running minute on the worst case for a `standard-1` instance -
 * provisioned memory and disk, and the full half vCPU busy the whole time - from Cloudflare's
 * Containers prices (October 2026). The real bill can only be lower. Pure functions; the
 * `Budget` Durable Object keeps the state.
 */

/** 4 GiB x 60 s x $0.0000025 + 8 GB x 60 s x $0.00000007 + 0.5 vCPU x 60 s x $0.00002. */
export const COST_PER_MINUTE_USD = 4 * 60 * 0.0000025 + 8 * 60 * 0.00000007 + 0.5 * 60 * 0.00002;

/** A slot nobody has charged against for this long belongs to a session that died. */
const STALE_SLOT_MS = 10 * 60_000;

export interface BudgetState {
  /** `yyyy-mm`, UTC. */
  readonly month: string;
  readonly spentUsd: number;
  /** Running sandboxes: uid -> the last time it was charged. */
  readonly running: Readonly<Record<string, number>>;
}

export interface BudgetConfig {
  readonly capUsd: number;
  readonly maxInstances: number;
}

export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function current(state: BudgetState, now: number): BudgetState {
  const month = monthKey(now);
  const running = Object.fromEntries(Object.entries(state.running).filter(([, at]) => now - at < STALE_SLOT_MS));
  return state.month === month ? { ...state, running } : { month, spentUsd: 0, running };
}

export function admit(state: BudgetState, uid: string, now: number, config: BudgetConfig):
  | { readonly ok: true; readonly state: BudgetState }
  | { readonly ok: false; readonly reason: "full" | "busy" } {
  const fresh = current(state, now);
  if (fresh.spentUsd >= config.capUsd) return { ok: false, reason: "full" };
  const already = Object.hasOwn(fresh.running, uid);
  if (!already && Object.keys(fresh.running).length >= config.maxInstances) return { ok: false, reason: "busy" };
  return { ok: true, state: { ...fresh, running: { ...fresh.running, [uid]: now } } };
}

export function charge(state: BudgetState, uid: string, minutes: number, now: number): BudgetState {
  const fresh = current(state, now);
  return {
    ...fresh,
    spentUsd: fresh.spentUsd + Math.max(0, minutes) * COST_PER_MINUTE_USD,
    running: { ...fresh.running, [uid]: now },
  };
}

export function release(state: BudgetState, uid: string): BudgetState {
  const running = { ...state.running };
  delete running[uid];
  return { ...state, running };
}
