import Link from "@/components/IntentLink";
import { INVITE_REWARD_TOKENS, PLANS, price, tokenAmount, type PricingOffer } from "@/lib/pricing";

export function PricingContent({ offer }: { offer: PricingOffer }) {
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <p className="pricing-eyebrow">Pricing</p>
          <h1>Start free.<br />Add more AI when you need it.</h1>
          <p>The editor stays free. Choose extra Heabsy usage for regular work, or add tokens for a busy week.</p>
        </div>
        <Link href="/ai-tokens" className="pricing-account">Manage your plan and tokens <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="pricing-free" aria-labelledby="pricing-free-heading">
        <div className="pricing-free-title">
          <p className="pricing-eyebrow">Always a place to start</p>
          <h2 id="pricing-free-heading">Free editor</h2>
          <p className="pricing-free-price">$0<span>No subscription required</span></p>
          <Link href="/versions" className="pricing-button">Download ADCode <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="pricing-free-details">
          <p>Code, run your project and work with agents without buying a plan.</p>
          <dl>
            <div><dt>Tagflow AI</dt><dd>No personal token or request quota from ADCode.</dd></div>
            <div><dt>Heabsy models</dt><dd><strong>{tokenAmount(offer.freeWeeklyTokens)} free tokens each week</strong>, shared across your devices.</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Included AI requires a verified ADCode account. Sponsored cards help fund the editor. Provider availability, shared capacity and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-section" aria-labelledby="pricing-plans-heading">
        <header className="pricing-section-head"><h2 id="pricing-plans-heading">More room for your week.</h2><p>Plans raise your weekly Heabsy allowance. Monthly billing still comes with a weekly refill.</p></header>
        {offer.available === false && <p className="pricing-notice" role="status">Plan and token sales are temporarily paused. The free editor is still available.</p>}
        <div className="pricing-plan-labels" aria-hidden="true"><span>Plan</span><span>Billing</span><span>Heabsy allowance</span><span /></div>
        <ul className="pricing-plans" aria-label="Heabsy AI plans">
          {PLANS.map(plan => (
            <li key={plan.id} className="pricing-plan" data-pro={plan.id === "pro"}>
              <div><h3>{plan.name}</h3>{plan.invites > 0 && <span className="pricing-plan-extra">Includes {plan.invites} friend invites</span>}</div>
              <p className="pricing-plan-price"><strong>{price(plan.priceCents)}</strong><span>/{plan.interval}</span></p>
              <p className="pricing-plan-tokens"><strong>{tokenAmount(plan.weeklyTokens)}</strong><span>tokens each week</span></p>
              <Link href={`/ai-tokens?plan=${plan.id}#plans`} className="pricing-button" aria-label={`View ${plan.name} plan`}>View {plan.name} <span aria-hidden="true">↗</span></Link>
            </li>
          ))}
        </ul>
        <p className="pricing-small pricing-plan-note">Plans renew at the billing interval shown. Manage or cancel in your Dodo portal; cancellation keeps access until the paid period ends. A plan raises the allowance for the week, so tokens already used still count.</p>
      </section>

      <section className="pricing-section pricing-packs-section" aria-labelledby="pricing-packs-heading">
        <header className="pricing-section-head"><h2 id="pricing-packs-heading">A top-up, without a subscription.</h2><p>One-time packs are used after your weekly allowance. Purchased tokens never expire.</p></header>
        <ul className="pricing-packs" aria-label="One-time Heabsy token packs">
          {offer.packs.map(pack => <li key={pack.id}><div><strong>{tokenAmount(pack.tokens)}<span>tokens</span></strong><p>{price(pack.priceCents)} once</p></div><Link href="/ai-tokens#packs" aria-label={`View ${tokenAmount(pack.tokens)} token pack`}>View pack <span aria-hidden="true">↗</span></Link></li>)}
        </ul>
        <p className="pricing-small">Prices are in USD. Dodo calculates applicable tax and shows the final amount before you pay. {offer.available === null && "The standard catalogue is shown while live availability is unavailable. "}Review the current offer in your account before checkout.</p>
      </section>

      <section className="pricing-invites" aria-labelledby="pricing-invites-heading">
        <div><p className="pricing-eyebrow">Build with a friend</p><h2 id="pricing-invites-heading">Pro comes with two invitations.</h2></div>
        <div><p>Each friend signs in and redeems your code before starting a paid plan. When their first subscription becomes active while your Pro plan is active, you both receive <strong>{tokenAmount(INVITE_REWARD_TOKENS)} extra tokens</strong>.</p><p className="pricing-small">Each friend can earn the reward once. Promo codes for tokens or plan days can be redeemed on the same account page.</p><Link href="/docs/ai-plans" className="pricing-text-link">How plans and invites work <span aria-hidden="true">↗</span></Link></div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you choose.</h2>
        <details><summary>Do I need to buy a plan to use ADCode?</summary><p>No. The editor and Tagflow AI remain free. Heabsy models include a free weekly allowance; a plan or pack adds more Heabsy usage. Your own provider connections remain available.</p></details>
        <details><summary>When does my allowance refill?</summary><p>The Heabsy week starts with your first request on those models. Your allowance refills each week, including with a monthly plan. It is shared across signed-in devices and does not roll over. Purchased tokens are separate and never expire.</p></details>
        <details><summary>What happens when I use the weekly allowance?</summary><p>Heabsy models use your purchased tokens next. If none remain, you can add a pack, choose a plan or switch to Tagflow AI. A bigger plan does not remove a provider’s temporary rate limits.</p></details>
        <details><summary>Where do I manage billing or redeem a code?</summary><p>Use <Link href="/ai-tokens">AI plans and tokens</Link> with the same ADCode account you use in the editor. Review your balance, manage a subscription, or redeem a promo or invite code there. Checkout and official invoices are handled by Dodo Payments.</p></details>
      </section>
    </div>
  );
}
