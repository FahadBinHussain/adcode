/**
 * The one Durable Object that adds up the month's spend and counts running sandboxes.
 *
 * Every `UserSession` asks it before starting a container and reports each running minute to
 * it. The rules are the pure functions in `budget.ts`; this keeps their state.
 */
import { DurableObject } from "cloudflare:workers";
import { admit, charge, currentBudget, monthKey, release, type BudgetState } from "./budget.ts";
import { numberVar, type Env } from "./env.ts";

const KEY = "state";

export class BudgetObject extends DurableObject<Env> {
  private async load(): Promise<BudgetState> {
    return (await this.ctx.storage.get<BudgetState>(KEY)) ?? { month: monthKey(Date.now()), spentUsd: 0, running: {} };
  }

  private config() {
    return { capUsd: numberVar(this.env.MONTHLY_CAP_USD, 20), maxInstances: numberVar(this.env.MAX_INSTANCES, 20) };
  }

  async admit(uid: string): Promise<{ ok: true } | { ok: false; reason: "full" | "busy" }> {
    const result = admit(await this.load(), uid, Date.now(), this.config());
    if (!result.ok) return result;
    await this.ctx.storage.put(KEY, result.state);
    return { ok: true };
  }

  async charge(uid: string, minutes: number): Promise<{ full: boolean }> {
    const state = charge(await this.load(), uid, minutes, Date.now());
    await this.ctx.storage.put(KEY, state);
    return { full: state.spentUsd >= this.config().capUsd };
  }

  async release(uid: string): Promise<void> {
    await this.ctx.storage.put(KEY, release(await this.load(), uid));
  }

  async stats(): Promise<{ month: string; spentUsd: number; capUsd: number; running: number; maxInstances: number }> {
    const state = currentBudget(await this.load(), Date.now());
    const config = this.config();
    return { month: state.month, spentUsd: Math.round(state.spentUsd * 100) / 100, capUsd: config.capUsd, running: Object.keys(state.running).length, maxInstances: config.maxInstances };
  }
}
