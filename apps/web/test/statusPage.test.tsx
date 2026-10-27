import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StatusView } from "../src/lib/statusView";

const reader = vi.hoisted(() => ({ value: null as StatusView | null }));
vi.mock("../src/lib/status", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/status")>(),
  readStatus: async () => reader.value,
}));
import StatusPage from "../src/app/status/page";

const fixture = (): StatusView => {
  const now = Date.parse("2026-10-24T16:30:00Z");
  const current = Date.parse("2026-10-24T16:00:00Z");
  return {
    asOf: now, windowDays: 7, liveWindowMinutes: 15,
    overall: { state: "operational", title: "All systems operational", activeIncidents: 0 },
    models: [{ provider: "tagflow", providerName: "Included AI", model: "working", name: "Working model",
      state: "operational", turns: 100, ok: 40, uptimePct: 40, errorPct: 60, avgMs: 1000,
      lastActiveDay: "2026-10-24", days: [],
      candles: Array.from({ length: 84 }, (_, index) => ({ startAt: current - (83 - index) * 7_200_000,
        endAt: current - (82 - index) * 7_200_000, level: "operational", turns: 1, errors: 0, avgMs: 1000 })),
    }], incidents: [],
  };
};

describe("status page functionality", () => {
  it("shows the live badge independently of historical errors and keeps every candle", async () => {
    reader.value = fixture();
    const html = renderToStaticMarkup(await StatusPage());
    expect(html).toContain("All systems operational");
    expect(html).toContain("60.00% errors");
    expect(html).toContain("live status: last 15 minutes");
    expect((html.match(/class="status-day"/g) ?? [])).toHaveLength(84);
    const details = html.match(/<details[^>]*>([\s\S]*?)<\/details>/)?.[1] ?? "";
    expect(details).toContain("Read the last 24 hours");
    expect((details.match(/<li>/g) ?? [])).toHaveLength(12);
    expect(details).toContain("UTC");
    expect(html).toContain('action="/v1/status/subscribe"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="models"');
    expect(html).toContain('name="incidents"');
    expect(html).toContain("/status/feed.xml");
  });

  it("shows unavailable measurements truthfully while retaining the alert form", async () => {
    reader.value = null;
    const html = renderToStaticMarkup(await StatusPage());
    expect(html).toContain("Status data is unavailable right now");
    expect(html).not.toContain("All systems operational");
    expect(html).toContain('action="/v1/status/subscribe"');
  });
});
