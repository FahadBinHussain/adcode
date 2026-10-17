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
        <h2 id="free-plan-heading">Free AI. Room to build.</h2>
        <p className="free-plan-intro">Start with included AI credits and a cloud workspace. No subscription or credit card required.</p>
      </header>
      <dl className="free-plan-grid">
        <div>
          <dt>AI credits</dt>
          <dd><strong>{credits(plan.sessionCredits)}</strong> every {plan.sessionHours} hours</dd>
        </div>
        <div>
          <dt>Helpers</dt>
          <dd><strong>Up to 4</strong> agents at once</dd>
        </div>
        <div>
          <dt>In your browser</dt>
          <dd><strong>1 hour</strong> of cloud time every {plan.sessionHours} hours</dd>
        </div>
      </dl>
      <p className="free-plan-limit">Up to {credits(plan.weeklyCredits)} AI credits a week. At the limit, tasks wait for the next refill. Desktop projects have no cloud time limit.</p>
      <details className="free-plan-details">
        <summary>How the free plan works</summary>
        <div>
          <p>Your balance refills every {plan.sessionHours} hours from your first message, up to {credits(plan.weeklyCredits)} credits a week. A credit is about 1,000 tokens; partner models that cost less go further.</p>
          <p>At the limit, a running task waits and resumes when credits refill. Your own key or a local model is never limited. The desktop app runs on your computer with no time limit.</p>
          <Link href="/docs/ai-credits">Read about AI credits <span aria-hidden="true">↗</span></Link>
        </div>
      </details>
    </section>
  );
}
