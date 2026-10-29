import { describe, expect, it } from "vitest";
import { assembleStatusView, liveLevelFor, readStatusView, telemetryModels } from "../src/status.ts";
import { STATUS_CANDLE_COUNT, STATUS_CANDLE_MS, type StatusBucketRow } from "../src/statusTelemetry.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const now = Date.parse("2026-10-24T14:45:00Z");
const latest = Date.parse("2026-10-24T14:00:00Z");
const catalog = new Map([
  ["working", { name: "Working model", providerName: "Included provider" }],
  ["quiet", { name: "Quiet model", providerName: "Included provider" }],
]);
const bucket = (over: Partial<StatusBucketRow> = {}): StatusBucketRow => ({
  startAt: latest, model: "working", outcome: "ok", count: 10, totalMs: 20_000, recentCount: 10, ...over,
});

describe("two-hour candles and live model status", () => {
  it("reserves a live outage for near-total failures with enough evidence", () => {
    expect(liveLevelFor(100, 0)).toBe("quiet");
    expect(liveLevelFor(0, 10)).toBe("operational");
    expect(liveLevelFor(4.99, 100)).toBe("operational");
    expect(liveLevelFor(5, 100)).toBe("degraded");
    expect(liveLevelFor(33, 100)).toBe("degraded");
    expect(liveLevelFor(89.99, 100)).toBe("degraded");
    expect(liveLevelFor(90, 100)).toBe("outage");
    expect(liveLevelFor(100, 4)).toBe("degraded");
  });
  it("shows recovery now while retaining earlier failures in the candles", () => {
    const models = telemetryModels(now, [
      bucket({ startAt: latest - 4 * STATUS_CANDLE_MS, outcome: "error", count: 20, totalMs: 0, recentCount: 0 }),
      bucket(),
    ], catalog);
    const model = models.find(model => model.model === "working")!;
    expect(model.state).toBe("operational");
    expect(model.errorPct).toBe(66.67);
    expect(model.candles).toHaveLength(84);
    expect(model.candles?.at(-5)).toMatchObject({ level: "outage", turns: 20, errors: 20 });
    expect(model.candles?.at(-1)).toMatchObject({ startAt: latest, endAt: latest + STATUS_CANDLE_MS, level: "operational", avgMs: 2_000 });
  });

  it("uses the rolling live sample independently of an aligned candle boundary", () => {
    const model = telemetryModels(now, [
      bucket({ startAt: latest - STATUS_CANDLE_MS, outcome: "error", count: 500, totalMs: 0, recentCount: 5 }),
      bucket(),
    ], catalog).find(model => model.model === "working")!;
    expect(model.state).toBe("degraded"); // 5 failures of 15 recent requests, not 500 of 510.
    expect(model.candles?.at(-1)?.level).toBe("operational");
  });

  it("never carries an old outage into a period without recent requests", () => {
    const model = telemetryModels(now, [bucket({ startAt: latest - 2 * STATUS_CANDLE_MS, outcome: "error", recentCount: 0 })], catalog)
      .find(model => model.model === "working")!;
    expect(model.state).toBe("quiet");
  });

  it("shows every enabled model and leaves empty intervals quiet with no invented success rate", () => {
    const models = telemetryModels(now, [], catalog);
    expect(models).toHaveLength(2);
    for (const model of models) {
      expect(model).toMatchObject({ state: "quiet", uptimePct: null, avgMs: null, turns: 0 });
      expect(model.candles).toHaveLength(STATUS_CANDLE_COUNT);
      expect(model.candles?.every(candle => candle.level === "quiet" && candle.turns === 0)).toBe(true);
      expect(model.candles?.at(0)?.startAt).toBe(latest - 83 * STATUS_CANDLE_MS);
    }
  });

  it("ignores disabled models, old buckets and future buckets", () => {
    const models = telemetryModels(now, [
      bucket({ model: "disabled", outcome: "error" }),
      bucket({ startAt: latest + STATUS_CANDLE_MS }),
      bucket({ startAt: latest - STATUS_CANDLE_COUNT * STATUS_CANDLE_MS }),
    ], catalog);
    expect(models.map(model => model.model).sort()).toEqual(["quiet", "working"]);
    expect(models.every(model => model.turns === 0)).toBe(true);
  });

  it("keeps real current failures in the overall banner and preserves incident priority", () => {
    const view = assembleStatusView({ now, days: 90, outcomes: [], incidents: [], updates: [], catalog,
      telemetry: [bucket({ outcome: "error", count: 10, totalMs: 0 })],
    });
    expect(view.windowDays).toBe(7);
    expect(view.liveWindowMinutes).toBe(15);
    expect(view.models.find(model => model.model === "working")?.state).toBe("outage");
    expect(view.overall.state).toBe("degraded");
    const allFailing = assembleStatusView({ now, days: 90, outcomes: [], incidents: [], updates: [], catalog,
      telemetry: [bucket({ outcome: "error", totalMs: 0 }), bucket({ model: "quiet", outcome: "error", totalMs: 0 })],
    });
    expect(allFailing.overall.state).toBe("outage");
    const incident = { incidentId: "maintenance", title: "Scheduled maintenance", impact: "maintenance" as const,
      status: "monitoring" as const, authorUid: "admin", createdAt: now, updatedAt: now, resolvedAt: null };
    expect(assembleStatusView({ now, days: 90, outcomes: [], incidents: [incident], updates: [], catalog, telemetry: [] }).overall)
      .toMatchObject({ state: "maintenance", title: "Scheduled maintenance" });
  });

  it("reads relay aggregates instead of client daily counters when available", async () => {
    const store = { ...createMemoryStore(),
      modelStatusBuckets: async (from: number, to: number) => {
        expect(from).toBe(latest - 83 * STATUS_CANDLE_MS);
        expect(to).toBe(now);
        return [bucket()];
      },
      modelOutcomesSince: async () => { throw new Error("daily counters should not be read"); },
    };
    const view = await readStatusView({ store, clock: { now: () => now } });
    expect(view.overall.state).toBe("operational");
    expect(view.models[0]?.candles).toHaveLength(84);
  });

  it("falls back to daily counters when the candle read fails, instead of reporting an outage", async () => {
    const store = { ...createMemoryStore(),
      modelStatusBuckets: async () => { throw new Error("function read_model_status_buckets does not exist"); },
      modelOutcomesSince: async () => [{ day: "2026-10-24", provider: "tagflow", model: "working", outcome: "ok", count: 10, totalMs: 10_000 }],
    };
    const view = await readStatusView({ store, clock: { now: () => now } });
    expect(view.overall.state).toBe("operational");
    expect(view.models[0]?.days?.length).toBeGreaterThan(0);
    expect(view.models[0]?.candles).toBeUndefined();
  });

  it("preserves the daily measurement window for monthly performance reports", async () => {
    const store = { ...createMemoryStore(),
      modelStatusBuckets: async () => { throw new Error("monthly reports should use daily counters"); },
      modelOutcomesSince: async () => [{ day: "2026-10-23", provider: "tagflow", model: "working", outcome: "ok", count: 10, totalMs: 10_000 }],
    };
    const view = await readStatusView({ store, clock: { now: () => now } }, 30, { daily: true });
    expect(view.windowDays).toBe(30);
    expect(view.models[0]?.days).toHaveLength(30);
    expect(view.models[0]?.candles).toBeUndefined();
  });
});
