import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countUpValue, LiveImpressionsCounter, LiveImpressionsCounterView } from "../src/components/LiveImpressionsCounter";
import { parseLiveImpressions } from "../src/lib/liveImpressions";

describe("countUpValue", () => {
  it("starts at zero and lands exactly on the real value", () => {
    expect(countUpValue(632, 0)).toBe(0);
    expect(countUpValue(632, 1)).toBe(632);
    expect(countUpValue(632, 5)).toBe(632);
  });
  it("only ever climbs", () => {
    let previous = 0;
    for (let step = 0; step <= 20; step += 1) {
      const value = countUpValue(632, step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
  it("continues from the displayed total when new activity arrives", () => {
    expect(countUpValue(1_250_000, 0, 1_200_000)).toBe(1_200_000);
    expect(countUpValue(1_250_000, 0.5, 1_200_000)).toBeGreaterThan(1_200_000);
    expect(countUpValue(1_250_000, 1, 1_200_000)).toBe(1_250_000);
  });
});

describe("LiveImpressionsCounter", () => {
  it("shows one large total with only the live-impressions label", () => {
    const markup = renderToStaticMarkup(createElement(LiveImpressionsCounterView, { state: { status: "ready", total: 1_250_000 } }));
    expect(markup).toContain(">1,250,000<");
    expect(markup).toContain("Live impressions");
    expect(markup).toContain('aria-label="1,250,000 live impressions"');
    expect(markup).not.toMatch(/developers|joined this week|accounts|AI usage|ads delivered|sessions|views/i);
  });

  it("keeps large totals in full and adjusts their size", () => {
    const markup = renderToStaticMarkup(createElement(LiveImpressionsCounterView, { state: { status: "ready", total: 123_456_789 } }));
    expect(markup).toContain(">123,456,789<");
    expect(markup).toContain('data-digits="medium"');
  });

  it("renders blank figures while loading rather than a guess", () => {
    const markup = renderToStaticMarkup(createElement(LiveImpressionsCounter));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("hero-dev-counter-blank");
    expect(markup).not.toMatch(/<dd>\+?\d/);
  });

  it("gets out of the way when the count is unavailable", () => {
    expect(renderToStaticMarkup(createElement(LiveImpressionsCounterView, { state: { status: "offline" } }))).toBe("");
  });

  it("has no invented baseline or random growth left in it", () => {
    const source = readFileSync(new URL("../src/components/LiveImpressionsCounter.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.random|HARDCODED|localStorage/);
  });
});

describe("live impressions data", () => {
  it("accepts zero and full, unabridged totals", () => {
    expect(parseLiveImpressions({ total: 0, asOf: 1 })).toEqual({ total: 0, asOf: 1 });
    expect(parseLiveImpressions({ total: 1_250_000, asOf: 1 })?.total).toBe(1_250_000);
  });
  it.each([null, {}, { total: -1, asOf: 1 }, { total: 1.5, asOf: 1 }, { total: Infinity, asOf: 1 }, { total: Number.MAX_SAFE_INTEGER + 1, asOf: 1 }, { total: 1, asOf: "now" }])("rejects invalid totals", (value) => {
    expect(parseLiveImpressions(value)).toBeNull();
  });
});
