import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dailyChange } from "../src/lib/dailyChange";
import { DailyChange } from "../src/components/DailyChange";

describe("daily metric changes", () => {
  it("handles growth, decline and zero without inventing infinity", () => {
    expect(dailyChange(125, 100)).toEqual({ label: "+25.0%", direction: "up" });
    expect(dailyChange(0, 100)).toEqual({ label: "-100.0%", direction: "down" });
    expect(dailyChange(0, 0)).toEqual({ label: "0.0%", direction: "flat" });
    expect(dailyChange(7, 0)).toEqual({ label: "New", direction: "up" });
    expect(dailyChange(20, null).direction).toBe("none");
    expect(dailyChange(20, NaN).direction).toBe("none");
  });
  it("preserves large exact money and treats a rate change as relative growth", () => {
    expect(dailyChange(11250000000000000000n, 9000000000000000000n).label).toBe("+25.0%");
    expect(dailyChange(0.125, 0.1).label).toBe("+25.0%");
  });
  it("marks an increase in errors as bad and exposes a readable comparison", () => {
    const html = renderToStaticMarkup(<DailyChange current={8} previous={4} lowerIsBetter />);
    expect(html).toContain('data-tone="bad"'); expect(html).toContain("+100.0%"); expect(html).toContain("vs yesterday");
    expect(renderToStaticMarkup(<DailyChange current={4} previous={8} lowerIsBetter />)).toContain('data-tone="good"');
  });
});
