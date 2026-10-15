import Link from "@/components/IntentLink";
import { TEAM } from "@/lib/site";
import styles from "./aboutUs.module.css";

export function AboutUs() {
  return (
    <section className={`marketplace-wrap ${styles.section}`} id="about" aria-labelledby="about-heading">
      <div className={styles.story}>
        <p className="marketplace-eyebrow">ABOUT US</p>
        <h2 id="about-heading">More freedom to create.<br />A fairer way to build.</h2>
        <p className={styles.lead}>We believe every developer deserves the tools to bring an idea to life—and a share in the value their attention creates.</p>
        <p>ADCode brings an AI workspace, a code editor, terminals, and Git together in one free app. An occasional sponsored card funds the editor, and 50% of eligible ad revenue is credited to the developer.</p>
        <p>Our goal is simple: help more people be creative, build something of their own, and earn while they do it. We’re building ADCode in the open, with developers at the centre of every decision.</p>
        <div className={styles.actions}>
          <a href={TEAM.bookingUrl} className="marketplace-secondary" target="_blank" rel="noopener noreferrer">Talk to the team <span aria-hidden="true">↗</span></a>
          <Link href="/earn-while-you-code">How your share works <span aria-hidden="true">→</span></Link>
        </div>
        <span className={styles.note}>A 30-minute conversation about ADCode, your ideas, or working together.</span>
      </div>
      <figure className={styles.founder}>
        {/* Explicit dimensions reserve the space; this is served locally with no third-party image request. */}
        <img src={TEAM.portrait} alt={`${TEAM.founder}, founder of ADCode`} width={1254} height={1254} loading="lazy" decoding="async" />
        <figcaption>
          <span className={styles.role}>MEET THE FOUNDER</span>
          <strong>{TEAM.founder}</strong>
          <span>Building ADCode at Bluethenics</span>
        </figcaption>
      </figure>
    </section>
  );
}
