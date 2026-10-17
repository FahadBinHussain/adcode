import { describe, expect, it } from "vitest";
import {
  addUsage,
  costOf,
  dayKey,
  formatTokens,
  formatUsageCost,
  parseUsageRows,
  pruneUsage,
  summarizeUsage,
  type UsageEntry,
  type UsageRow,
} from "../src/shared/aiUsage.ts";

const NOW = new Date(2026, 9, 9, 15, 0, 0).getTime();
const DAY = 86_400_000;
const price = { inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 };

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return { provider: "anthropic", model: "claude-opus-5-5", source: "chat", inputTokens: 1_000, outputTokens: 200, estimated: false, at: NOW, price, ...overrides };
}

describe("recording", () => {
  it("adds a request to its day's row for that model and source", () => {
    let rows: UsageRow[] = [];
    rows = addUsage(rows, entry());
    rows = addUsage(rows, entry({ inputTokens: 500, outputTokens: 100 }));
    rows = addUsage(rows, entry({ source: "agents" }));
    rows = addUsage(rows, entry({ at: NOW - DAY }));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ day: dayKey(NOW), source: "chat", requests: 2, inputTokens: 1_500, outputTokens: 300 });
  });

  it("prices a request from the catalogue, in millionths of a dollar", () => {
    // 1,000 in at $3/M and 200 out at $15/M is $0.003 + $0.003.
    expect(costOf(price, 1_000, 200)).toBe(6_000);
    const [row] = addUsage([], entry());
    expect(row).toMatchObject({ costMicros: 6_000, pricedRequests: 1 });
  });

  it("keeps cached input as part of the input, priced at the catalogue's cache-read rate", () => {
    const cachePriced = { ...price, cacheReadMicrosPerMillion: 300_000 };
    // 1,000 in, 800 of them cached: 200 at $3/M + 800 at $0.30/M + 200 out at $15/M.
    expect(costOf(cachePriced, 1_000, 200, 800)).toBe(600 + 240 + 3_000);
    // No cache price in the catalogue: cached input is priced as input, never as free.
    expect(costOf(price, 1_000, 200, 800)).toBe(6_000);
    let rows = addUsage([], entry({ price: cachePriced, cachedTokens: 800 }));
    rows = addUsage(rows, entry({ price: cachePriced, cachedTokens: 5_000 }));
    expect(rows[0]).toMatchObject({ inputTokens: 2_000, cachedTokens: 1_800 });
    const view = summarizeUsage(rows, "today", NOW);
    expect(view.totals.cachedTokens).toBe(1_800);
    expect(view.models[0]?.cachedTokens).toBe(1_800);
  });

  it("keeps an unpriced model's cost unknown rather than zero", () => {
    const rows = addUsage([], entry({ provider: "custom", model: "mystery", price: null }));
    const view = summarizeUsage(rows, "today", NOW);
    expect(view.models[0]?.costMicros).toBeNull();
    expect(view.totals.costMicros).toBeNull();
    expect(formatUsageCost(null)).toBe("No price");
  });

  it("marks a model whose counts were estimated", () => {
    const rows = addUsage(addUsage([], entry()), entry({ estimated: true }));
    expect(summarizeUsage(rows, "today", NOW).models[0]?.estimated).toBe(true);
  });
});

describe("summarising", () => {
  const rows = [
    entry({ model: "big", inputTokens: 9_000, outputTokens: 1_000 }),
    entry({ model: "small", inputTokens: 900, outputTokens: 100, source: "agents" }),
    entry({ model: "old", at: NOW - 10 * DAY }),
    entry({ model: "unpriced", price: null, inputTokens: 50, outputTokens: 50 }),
  ].reduce<UsageRow[]>((all, one) => addUsage(all, one), []);

  it("sums only the range asked for, most tokens first, with each model's share", () => {
    const week = summarizeUsage(rows, "7d", NOW);
    expect(week.models.map((model) => model.model)).toEqual(["big", "small", "unpriced"]);
    expect(week.totals.requests).toBe(3);
    expect(week.models[0]!.share).toBeCloseTo(10_000 / 11_100, 5);
    expect(week.models[1]).toMatchObject({ chatRequests: 0, agentRequests: 1 });
    expect(summarizeUsage(rows, "30d", NOW).models.map((model) => model.model)).toContain("old");
  });

  it("says the total cost is partial when some models have no price", () => {
    const view = summarizeUsage(rows, "7d", NOW);
    expect(view.totals.costMicros).not.toBeNull();
    expect(view.totals.costPartial).toBe(true);
  });

  it("gives every day in the range a bar, empty days included", () => {
    const view = summarizeUsage(rows, "7d", NOW);
    expect(view.days).toHaveLength(7);
    expect(view.days[6]).toEqual({ day: dayKey(NOW), tokens: 11_100 });
    expect(view.days[0]!.tokens).toBe(0);
    expect(view.since).toBe(dayKey(NOW - 10 * DAY));
  });

  it("shows nothing, not an error, before anything was used", () => {
    const view = summarizeUsage([], "today", NOW);
    expect(view.models).toEqual([]);
    expect(view.totals.requests).toBe(0);
    expect(view.since).toBeNull();
    expect(view.days).toHaveLength(1);
  });
});

describe("the file", () => {
  it("reads back what it wrote and drops anything malformed", () => {
    const rows = addUsage([], entry());
    expect(parseUsageRows(JSON.parse(JSON.stringify({ version: 1, rows })))).toEqual(rows);
    expect(parseUsageRows({ rows: [{ ...rows[0], source: "ads" }, { ...rows[0], requests: -1 }, "x", null] })).toEqual([]);
    expect(parseUsageRows("nonsense")).toEqual([]);
    // A file from before cached counts were kept reads as nothing cached, never as invalid.
    const older = Object.fromEntries(Object.entries(rows[0]!).filter(([key]) => key !== "cachedTokens"));
    expect(parseUsageRows({ rows: [older] })).toEqual([{ ...older, cachedTokens: 0 }]);
  });

  it("forgets rows past the keep window", () => {
    const rows = addUsage(addUsage([], entry()), entry({ at: NOW - 500 * DAY }));
    expect(pruneUsage(rows, NOW).map((row) => row.day)).toEqual([dayKey(NOW)]);
  });
});

describe("formatting", () => {
  it("says counts and money the way people say them", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12k");
    expect(formatTokens(3_100)).toBe("3.1k");
    expect(formatTokens(3_100_000)).toBe("3.1M");
    expect(formatUsageCost(0)).toBe("$0.00");
    expect(formatUsageCost(4_000)).toBe("< $0.01");
    expect(formatUsageCost(1_234_567)).toBe("$1.23");
  });
});
