import { PARTNERS, type Partner } from "@/lib/partners";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

function PartnerMark({ partner }: { partner: Partner }) {
  const { logo, logoDark, wordmark } = partner;
  const kind = wordmark ? "partner-logo partner-logo-wordmark" : "partner-logo";
  if (logo === undefined) return null;
  // The name is printed beside the mark, so the image itself is decoration to a screen reader.
  return <>
    <img className={logoDark === undefined ? kind : `${kind} partner-logo-light`} src={logo.src} alt="" width={logo.width} height={logo.height} loading="lazy" decoding="async" />
    {logoDark === undefined ? null : <img className={`${kind} partner-logo-dark`} src={logoDark.src} alt="" width={logoDark.width} height={logoDark.height} loading="lazy" decoding="async" />}
  </>;
}

/**
 * Partners, directly under the hero recording: who ADCode works with, each a link to them.
 * It answers the doubt the recording raises - "free AI, from whom?" - so each partner says
 * in a line what they do here, and the band stays short enough to read in passing.
 */
export function Partners() {
  if (PARTNERS.length === 0) return null;
  return <section className="partners" aria-labelledby="partners-heading">
    <div className="partners-intro">
      <h2 id="partners-heading" className="partners-heading">Partners</h2>
      <p className="partners-lede">The free AI in ADCode comes from our partners. No key to find, no bill to pay.</p>
    </div>
    <ul className="partners-list">
      {PARTNERS.map((partner) => <li key={partner.href}>
        <a className="partner" href={partner.href} target="_blank" rel="noreferrer">
          <span className="partner-top">
            <PartnerMark partner={partner} />
            <span className={partner.wordmark && partner.logo ? "partner-name partner-name-hidden" : "partner-name"}>{partner.name}</span>
            <span className="partner-arrow" aria-hidden="true"><Icon node={ArrowUpRight} /></span>
          </span>
          <span className="partner-role">{partner.role}</span>
        </a>
      </li>)}
    </ul>
  </section>;
}
