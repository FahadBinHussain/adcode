import Link from "next/link";

export function FreePlan() {
  return (
    <section className="free-plan marketplace-wrap" id="free-plan" aria-labelledby="free-plan-heading">
      <header className="free-plan-head">
        <p className="marketplace-eyebrow">THE FREE PLAN</p>
        <h2 id="free-plan-heading">Free AI. Room to build.</h2>
        <p className="free-plan-intro">Start with unlimited included AI and a cloud workspace. No subscription or credit card required.</p>
      </header>
      <dl className="free-plan-grid">
        <div>
          <dt>Included AI</dt>
          <dd><strong>Unlimited</strong> requests</dd>
        </div>
        <div>
          <dt>Helpers</dt>
          <dd><strong>Up to 4</strong> agents at once</dd>
        </div>
        <div>
          <dt>In your browser</dt>
          <dd><strong>No personal</strong> time limit</dd>
        </div>
      </dl>
      <p className="free-plan-limit">No ADCode token, request, or credit allowance. Provider availability, model context limits, and shared cloud capacity still apply.</p>
      <details className="free-plan-details">
        <summary>How the free plan works</summary>
        <div>
          <p>Keep building without waiting for a daily or weekly allowance to refill.</p>
          <p>Idle cloud workspaces sleep automatically and resume with your work saved. Your own provider key follows that provider’s billing.</p>
          <Link href="/docs/ai-credits">Read about included AI <span aria-hidden="true">↗</span></Link>
        </div>
      </details>
    </section>
  );
}
