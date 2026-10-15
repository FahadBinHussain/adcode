import Link from "next/link";
import { DEFAULT_CREDIT_PLAN } from "@adcode/api/src/credits.ts";

/*
 * What the free plan includes, in numbers, before anybody installs.
 *
 * "Free AI built in" invites the obvious next question - how much, and what happens when it
 * runs out - and a visitor who has to install to find out mostly does not. This answers it the
 * way a paid plan page would: the allowance, the refill, and what happens at the limit. The
 * numbers come from the same defaults the relay enforces.
 */
const credits = (value: number): string => value.toLocaleString("en-US");

export function FreePlan() {
  const plan = DEFAULT_CREDIT_PLAN;
  return (
    <section className="free-plan marketplace-wrap" id="free-plan" aria-labelledby="free-plan-heading">
      <header className="free-plan-head">
        <p className="marketplace-eyebrow">THE FREE PLAN</p>
        <h2 id="free-plan-heading">A full AI allowance every {plan.sessionHours} hours.<br /><span>Free, with no key.</span></h2>
        <p>Like a Claude Max plan, minus the bill: your free AI refills every {plan.sessionHours} hours from your first message, with a weekly ceiling, and one balance covers every free model.</p>
      </header>
      <dl className="free-plan-grid">
        <div>
          <dt>AI credits</dt>
          <dd><strong>{credits(plan.sessionCredits)}</strong> every {plan.sessionHours} hours</dd>
          <dd>{credits(plan.weeklyCredits)} a week. A credit is about 1,000 tokens; partner models that cost less go further.</dd>
        </div>
        <div>
          <dt>Helpers</dt>
          <dd><strong>Up to 4</strong> agents at once</dd>
          <dd>Big jobs split across helpers that research and build side by side, with one Undo for all of it.</dd>
        </div>
        <div>
          <dt>At the limit</dt>
          <dd><strong>Nothing breaks</strong></dd>
          <dd>A running task waits and carries on by itself when your credits refill. Your own key or a local model is never limited.</dd>
        </div>
        <div>
          <dt>In your browser</dt>
          <dd><strong>1 hour</strong> of cloud time every {plan.sessionHours} hours</dd>
          <dd>The desktop app runs on your own computer, with no time limit at all.</dd>
        </div>
      </dl>
      <p className="free-plan-foot"><Link href="/docs/ai-credits">How credits work <span aria-hidden="true">↗</span></Link></p>
    </section>
  );
}
