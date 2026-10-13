import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../src/app/page";
import { Partners } from "../src/components/Partners";
import { PARTNERS } from "../src/lib/partners";

const publicFile = (src: string): string => fileURLToPath(new URL(`../public${src}`, import.meta.url));

describe("partners", () => {
  it("lists Tagflow AI, Heabsy and Bluethenics, each linked to its site with what it does", () => {
    const markup = renderToStaticMarkup(<Partners />);
    for (const [name, href] of [["Tagflow AI", "https://tagflow-ai.com"], ["Heabsy", "https://heabsy.com"], ["Bluethenics", "https://bluethenics.com"]]) {
      expect(markup).toContain(`${name}</span>`);
      expect(markup).toContain(`href="${href}"`);
    }
    expect((markup.match(/class="partner-role"/g) ?? []).length).toBe(PARTNERS.length);
    expect(markup).toContain('rel="noreferrer"');
  });

  it("sits directly under the hero recording", () => {
    const markup = renderToStaticMarkup(<Home />);
    const showcase = markup.indexOf('class="app-showcase"');
    const partners = markup.indexOf('class="partners"');
    expect(showcase).toBeGreaterThan(-1);
    expect(partners).toBeGreaterThan(showcase);
    // Nothing else between the end of the recording's figure and the partners row.
    expect(markup.slice(markup.indexOf("</figure>", showcase), partners)).toBe("</figure><section ");
  });

  it("never points at a logo that is not committed, and links only over https", () => {
    for (const partner of PARTNERS) {
      expect(partner.name.trim().length).toBeGreaterThan(0);
      expect(partner.href.startsWith("https://")).toBe(true);
      for (const logo of [partner.logo, partner.logoDark]) {
        if (logo === undefined) continue;
        expect(existsSync(publicFile(logo.src)), logo.src).toBe(true);
        if (logo.src.endsWith(".svg")) expect(readFileSync(publicFile(logo.src), "utf8")).not.toMatch(/<script|on\w+=/i);
      }
    }
  });

  it("prints a wordmark partner's name for screen readers only, beside its logo", () => {
    const markup = renderToStaticMarkup(<Partners />);
    expect(markup).toContain('class="partner-name partner-name-hidden">Heabsy</span>');
    expect(markup).toContain('class="partner-name">Tagflow AI</span>');
    expect(markup).toContain('src="/partners/tagflow-dark.png"');
    expect(markup).toContain('class="partner-logo partner-logo-wordmark partner-logo-dark"');
  });

  it("draws only logos that exist, and the name either way", () => {
    const markup = renderToStaticMarkup(<Partners />);
    const logos = PARTNERS.reduce((sum, partner) => sum + (partner.logo ? 1 : 0) + (partner.logoDark ? 1 : 0), 0);
    expect((markup.match(/<img /g) ?? []).length).toBe(logos);
    expect((markup.match(/class="partner-name[ "]/g) ?? []).length).toBe(PARTNERS.length);
  });
});
