import { beforeEach, describe, expect, it } from "vitest";
import type { TokenVerifier } from "../src/auth.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { ModelOutcomeRow } from "../src/modelOutcomes.ts";
import {
  STATUS_MIN_SAMPLE,
  assembleStatusView,
  buildIncidentViews,
  levelFor,
  modelDisplayName,
  parseIncidentDraft,
  parseIncidentUpdate,
  providerDisplayName,
  type StatusIncidentRecord,
  type StatusIncidentUpdateRecord,
} from "../src/status.ts";

/**
 * The public status page.
 *
 * Two halves that have to agree: what the editors already report (per-model daily outcome
 * counts) and what an administrator writes by hand (incidents). These tests pin the
 * vocabulary both halves share - what "degraded" means, what a bar is coloured - and then
 * the routes that serve it.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user") return { uid: "u-1", claims: {} };
    return null;
  },
};

const draft = (over: Record<string, unknown> = {}) => ({
  title: "Elevated errors on Tagflow models",
  impact: "major",
  status: "investigating",
  body: "We are looking into reports of failed requests.",
  ...over,
});

const update = (over: Record<string, unknown> = {}) => ({
  status: "identified",
  body: "The cause is a bad deploy; a rollback is in progress.",
  ...over,
});

describe("parseIncidentDraft", () => {
  it("reads a well-formed incident", () => {
    expect(parseIncidentDraft(draft())).toEqual({
      title: "Elevated errors on Tagflow models",
      impact: "major",
      status: "investigating",
      body: "We are looking into reports of failed requests.",
    });
  });

  it.each([
    ["nothing", undefined],
    ["a string", "incident"],
    ["an impact the page cannot colour", draft({ impact: "catastrophic" })],
    ["a status the page does not know", draft({ status: "resolved-ish" })],
    ["an empty title", draft({ title: "   " })],
    ["an empty body", draft({ body: "" })],
    ["a title past the cap", draft({ title: "x".repeat(121) })],
    ["a body past the cap", draft({ body: "x".repeat(2001) })],
  ])("refuses %s", (_label, raw) => {
    expect(parseIncidentDraft(raw)).toBeNull();
  });
});

describe("parseIncidentUpdate", () => {
  it("reads a well-formed update", () => {
    expect(parseIncidentUpdate(update())).toEqual({
      status: "identified",
      body: "The cause is a bad deploy; a rollback is in progress.",
    });
  });

  it.each([
    ["nothing", undefined],
    ["a status the page does not know", update({ status: "fixed" })],
    ["an empty body", update({ body: "  " })],
    ["a body past the cap", update({ body: "x".repeat(2001) })],
  ])("refuses %s", (_label, raw) => {
    expect(parseIncidentUpdate(raw)).toBeNull();
  });
});

describe("levelFor", () => {
  it("calls no traffic quiet rather than broken", () => {
    expect(levelFor(0, 0)).toBe("quiet");
    expect(levelFor(100, 0)).toBe("quiet");
  });

  it("draws the line at five percent", () => {
    expect(levelFor(0, 100)).toBe("operational");
    expect(levelFor(4.99, 100)).toBe("operational");
    expect(levelFor(5, 100)).toBe("degraded");
    expect(levelFor(24.99, 100)).toBe("degraded");
    expect(levelFor(25, 100)).toBe("outage");
  });

  /*
   * One failure in three requests is 33% and means nothing. A red bar from a sample that
   * small would teach people to ignore red bars.
   */
  it("refuses to call a tiny sample an outage", () => {
    expect(levelFor(33, STATUS_MIN_SAMPLE - 1)).toBe("degraded");
    expect(levelFor(33, STATUS_MIN_SAMPLE)).toBe("outage");
  });
});

describe("display names", () => {
  it("turns model ids into names a person recognises", () => {
    expect(modelDisplayName("tagflow-code-27b")).toBe("Tagflow Code 27B");
    expect(modelDisplayName("qwen3-coder-30b-a3b")).toBe("Qwen3 Coder 30B A3B");
    expect(modelDisplayName("openrouter/stealth/space-bunny-alpha")).toBe("Space Bunny Alpha");
  });

  /*
   * Taken from the real catalogue. Each of these read wrong once: dots were word breaks
   * ("Qwen2 5 Coder"), a tag leaked into the name ("Coder:7b"), and initialisms were
   * title-cased ("Gpt Oss").
   */
  it("keeps version dots and reads initialisms the way the vendor does", () => {
    expect(modelDisplayName("qwen2.5-coder:7b")).toBe("Qwen2.5 Coder 7B");
    expect(modelDisplayName("qwen2.5:14b-64k")).toBe("Qwen2.5 14B 64K");
    expect(modelDisplayName("nvidia/nemotron-3.5-super-vl:free")).toBe("Nemotron 3.5 Super VL");
    expect(modelDisplayName("groq/openai/gpt-oss-120b")).toBe("GPT OSS 120B");
    expect(modelDisplayName("custom/deepseek-ai/DeepSeek-V4.1-Flash")).toBe("DeepSeek V4.1 Flash");
    expect(modelDisplayName("heabsy-glm53-flash-unc")).toBe("Heabsy GLM53 Flash Unc");
    expect(modelDisplayName("custom/glm-5.3-flash-free")).toBe("GLM 5.3 Flash Free");
    expect(modelDisplayName("ollama/gemma4:e4b")).toBe("Gemma4 E4B");
    expect(modelDisplayName("ollama/qwen2.5-coder:7b-instruct-q4_K_M")).toBe("Qwen2.5 Coder 7B Instruct Q4 K M");
  });

  it("drops a tag that says how a model is served and keeps one that says what it is", () => {
    expect(modelDisplayName("ollama/hacking:latest")).toBe("Hacking");
    expect(modelDisplayName("ollama/beam:cloud")).toBe("Beam");
    expect(modelDisplayName("ollama/satgeze/ornith-9b-1m:Q6_K")).toBe("Ornith 9B 1M Q6 K");
  });

  it("joins a version written with dashes, and leaves two real numbers alone", () => {
    expect(modelDisplayName("openrouter/mistralai/mistral-large-4-0")).toBe("Mistral Large 4.0");
    expect(modelDisplayName("ollama/mimo-v2-5-flash")).toBe("MiMo V2.5 Flash");
    expect(modelDisplayName("ollama/gemma-4-12B-agentic")).toBe("Gemma 4 12B Agentic");
  });

  it("falls back to the whole path when the last segment is only a delivery", () => {
    expect(modelDisplayName("openrouter/openrouter/free")).toBe("Openrouter Free");
  });

  it("keeps provider names that are not just casings of the id", () => {
    expect(providerDisplayName("tagflow")).toBe("Tagflow AI");
    expect(providerDisplayName("openai")).toBe("OpenAI");
    expect(providerDisplayName("someone-new")).toBe("Someone-new");
  });
});

describe("assembleStatusView", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const day = (back: number): string => new Date(now - back * 86_400_000).toISOString().slice(0, 10);

  const row = (over: Partial<ModelOutcomeRow> = {}): ModelOutcomeRow => ({
    day: day(0),
    provider: "tagflow",
    model: "tagflow-code-27b",
    outcome: "ok",
    count: 1,
    totalMs: 1_000,
    ...over,
  });

  const incident = (over: Partial<StatusIncidentRecord> = {}): StatusIncidentRecord => ({
    incidentId: "inc-1",
    title: "Elevated errors on Tagflow models",
    impact: "major",
    status: "investigating",
    authorUid: "admin-1",
    createdAt: now - 3_600_000,
    updatedAt: now - 3_600_000,
    resolvedAt: null,
    ...over,
  });

  const incidentUpdate = (over: Partial<StatusIncidentUpdateRecord> = {}): StatusIncidentUpdateRecord => ({
    updateId: "incupd-1",
    incidentId: "inc-1",
    status: "investigating",
    body: "We are looking into it.",
    authorUid: "admin-1",
    createdAt: now - 3_600_000,
    ...over,
  });

  it("lays out a full window of days, zeroes included", () => {
    const view = assembleStatusView({
      now,
      days: 90,
      outcomes: [row({ count: 10, totalMs: 10_000 })],
      incidents: [],
      updates: [],
    });
    expect(view.windowDays).toBe(90);
    expect(view.models[0]?.days).toHaveLength(90);
    expect(view.models[0]?.days[0]).toMatchObject({ day: day(89), level: "quiet", turns: 0 });
    expect(view.models[0]?.days[89]).toMatchObject({ day: day(0), level: "operational", turns: 10, avgMs: 1_000 });
  });

  it("computes uptime over answers and the service's own failures", () => {
    const view = assembleStatusView({
      now,
      days: 30,
      outcomes: [
        row({ count: 8, totalMs: 8_000 }),
        row({ outcome: "server", count: 2, totalMs: 200 }),
        // Stopped turns are not the model's fault and must not move the percentage.
        row({ outcome: "cancelled", count: 50, totalMs: 50_000 }),
      ],
      incidents: [],
      updates: [],
    });
    const model = view.models[0];
    expect(model).toMatchObject({ turns: 10, ok: 8, uptimePct: 80, errorPct: 20 });
    // 20% is degraded, and the day carries the errors in its tooltip.
    expect(model?.days[29]).toMatchObject({ turns: 10, errors: 2, level: "degraded" });
  });

  it("never calls a model broken for the person's own situation", () => {
    // 2026-10-20: signed-out turns, long conversations and dropped connections made every
    // included model read "outage" while the relay was answering nearly everything.
    const view = assembleStatusView({
      now,
      days: 30,
      outcomes: [
        row({ count: 20, totalMs: 20_000 }),
        ...["auth", "credits", "too_large", "network", "history", "output_limit", "thinking_limit", "refused", "other"].map((outcome) =>
          row({ outcome, count: 10, totalMs: 100 }),
        ),
      ],
      incidents: [],
      updates: [],
    });
    expect(view.models[0]).toMatchObject({ turns: 20, ok: 20, uptimePct: 100, state: "operational" });
    expect(view.overall.state).toBe("operational");
  });

  it("reports the newest active day as the model's state", () => {
    const view = assembleStatusView({
      now,
      days: 30,
      outcomes: [row({ day: day(2), count: 10, totalMs: 10_000 })],
      incidents: [],
      updates: [],
    });
    expect(view.models[0]).toMatchObject({ state: "operational", lastActiveDay: day(2) });
  });

  it("reports partial degradation when one model fails and another is working", () => {
    const view = assembleStatusView({
      now,
      days: 30,
      outcomes: [
        row({ count: 10, totalMs: 10_000 }),
        row({ provider: "groq", model: "llama", outcome: "server", count: 10, totalMs: 1_000 }),
      ],
      incidents: [],
      updates: [],
    });
    expect(view.overall).toEqual({
      state: "degraded",
      title: "One model is failing requests",
      activeIncidents: 0,
    });
  });

  it("lets an active incident speak for the banner, worst impact first", () => {
    const view = assembleStatusView({
      now,
      days: 30,
      outcomes: [row({ count: 10, totalMs: 10_000 })],
      incidents: [
        incident({ incidentId: "inc-minor", title: "Slow responses on one model", impact: "minor", createdAt: now - 7_200_000 }),
        incident(),
      ],
      updates: [incidentUpdate(), incidentUpdate({ updateId: "incupd-2", incidentId: "inc-minor", body: "Slow, not failing." })],
    });
    expect(view.overall).toEqual({
      state: "outage",
      title: "Elevated errors on Tagflow models",
      activeIncidents: 2,
    });
    expect(view.incidents[0]?.updates).toHaveLength(1);
  });

  it("drops resolved incidents out of the window but keeps an unresolved one", () => {
    const view = assembleStatusView({
      now,
      days: 90,
      outcomes: [row({ count: 10, totalMs: 10_000 })],
      incidents: [
        incident({ incidentId: "inc-old", status: "resolved", resolvedAt: now - 100 * 86_400_000, createdAt: now - 100 * 86_400_000 }),
        incident({ incidentId: "inc-ancient", status: "monitoring", createdAt: now - 120 * 86_400_000 }),
      ],
      updates: [],
    });
    expect(view.incidents.map((i) => i.incidentId)).toEqual(["inc-ancient"]);
    expect(view.overall).toEqual({
      state: "outage",
      title: "Elevated errors on Tagflow models",
      activeIncidents: 1,
    });
  });

  it("refuses to shrink below a week of bars", () => {
    const view = assembleStatusView({ now, days: 1, outcomes: [], incidents: [], updates: [] });
    expect(view.windowDays).toBe(7);
    expect(view.models).toEqual([]);
    expect(view.overall.state).toBe("operational");
  });
});

describe("buildIncidentViews", () => {
  it("puts the newest update first and never invents an incident from an orphan update", () => {
    const views = buildIncidentViews(
      [{
        incidentId: "inc-1",
        title: "Errors",
        impact: "minor",
        status: "identified",
        authorUid: "admin-1",
        createdAt: 100,
        updatedAt: 300,
        resolvedAt: null,
      }],
      [
        { updateId: "u-old", incidentId: "inc-1", status: "investigating", body: "Looking.", authorUid: "admin-1", createdAt: 100 },
        { updateId: "u-new", incidentId: "inc-1", status: "identified", body: "Found it.", authorUid: "admin-1", createdAt: 300 },
        { updateId: "u-orphan", incidentId: "inc-missing", status: "resolved", body: "?", authorUid: "admin-1", createdAt: 400 },
      ],
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.updates.map((u) => u.updateId)).toEqual(["u-new", "u-old"]);
  });
});

describe("the routes", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let handle: (request: Request) => Promise<Response>;
  let now = 0;

  beforeEach(async () => {
    now = Date.UTC(2026, 9, 19, 12);
    store = createMemoryStore();
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    handle = createFetchHandler({ store, verifier, clock: { now: () => now } });
  });

  const call = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
    handle(new Request(`https://adcode.test${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }));

  const seedOutcomes = async (): Promise<void> => {
    expect((await call("/v1/model-outcomes", {
      method: "POST",
      token: "user",
      body: {
        outcomes: [
          { provider: "tagflow", model: "tagflow-code-27b", outcome: "ok", ms: 1_000 },
          { provider: "tagflow", model: "tagflow-code-27b", outcome: "ok", ms: 1_500 },
          { provider: "tagflow", model: "tagflow-code-27b", outcome: "ok", ms: 1_100 },
          { provider: "tagflow", model: "tagflow-code-27b", outcome: "server", ms: 300 },
        ],
      },
    })).status).toBe(200);
  };

  it("serves model health to nobody in particular", async () => {
    await seedOutcomes();
    const response = await call("/v1/status");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=30");

    const view = await response.json() as {
      windowDays: number;
      overall: { state: string };
      models: Array<{ model: string; name: string; turns: number; ok: number; uptimePct: number; days: unknown[] }>;
      incidents: unknown[];
    };
    expect(view.windowDays).toBe(90);
    // Three of four turns working reads 75% - degraded, not broken. The page should say so
    // rather than round a small sample to green.
    expect(view.overall).toEqual({
      state: "degraded",
      title: "Elevated error rates on some models",
      activeIncidents: 0,
    });
    expect(view.incidents).toEqual([]);
    expect(view.models[0]).toMatchObject({
      model: "tagflow-code-27b",
      name: "Tagflow Code 27B",
      turns: 4,
      ok: 3,
      uptimePct: 75,
    });
    expect(view.models[0]?.days).toHaveLength(90);
  });

  it("takes an incident from an admin and gives the page its banner", async () => {
    await seedOutcomes();
    expect((await call("/v1/admin/status/incidents", { method: "POST", body: draft() })).status).toBe(401);
    expect((await call("/v1/admin/status/incidents", { method: "POST", token: "user", body: draft() })).status).toBe(403);
    expect((await call("/v1/admin/status/incidents", { method: "POST", token: "admin", body: draft({ impact: "catastrophic" }) })).status).toBe(400);

    const created = await call("/v1/admin/status/incidents", { method: "POST", token: "admin", body: draft() });
    expect(created.status).toBe(200);
    const incident = await created.json() as { incidentId: string; status: string; resolvedAt: null };
    expect(incident.status).toBe("investigating");
    expect(incident.resolvedAt).toBeNull();

    const view = await (await call("/v1/status")).json() as {
      overall: { state: string; title: string; activeIncidents: number };
      incidents: Array<{ title: string; updates: Array<{ body: string }> }>;
    };
    expect(view.overall).toEqual({
      state: "outage",
      title: "Elevated errors on Tagflow models",
      activeIncidents: 1,
    });
    expect(view.incidents[0]?.updates[0]?.body).toBe("We are looking into reports of failed requests.");

    // The panel reads the same incident back, resolved ones included.
    const admin = await call("/v1/admin/status", { token: "admin" });
    expect(admin.status).toBe(200);
    const listed = await admin.json() as { incidents: Array<{ incidentId: string }> };
    expect(listed.incidents[0]?.incidentId).toBe(incident.incidentId);
    expect((await call("/v1/admin/status", { token: "user" })).status).toBe(403);
  });

  it("lets an admin resolve an incident, and quietly reopens it when it was not over", async () => {
    const incident = await (await call("/v1/admin/status/incidents", { method: "POST", token: "admin", body: draft() }))
      .json() as { incidentId: string };

    expect((await call(`/v1/admin/status/incidents/${incident.incidentId}/updates`, { method: "POST", token: "admin", body: update({ status: "nope" }) })).status).toBe(400);
    expect((await call("/v1/admin/status/incidents/inc-missing/updates", { method: "POST", token: "admin", body: update() })).status).toBe(404);

    const resolved = await call(`/v1/admin/status/incidents/${incident.incidentId}/updates`, {
      method: "POST",
      token: "admin",
      body: update({ status: "resolved", body: "The rollback is complete." }),
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ status: "resolved", resolvedAt: now });

    const afterResolve = await (await call("/v1/status")).json() as {
      overall: { state: string };
      incidents: Array<{ status: string; resolvedAt: number | null }>;
    };
    expect(afterResolve.overall.state).toBe("operational");
    expect(afterResolve.incidents[0]).toMatchObject({ status: "resolved", resolvedAt: now });

    // Reopening: any status but resolved clears the resolution time.
    await call(`/v1/admin/status/incidents/${incident.incidentId}/updates`, {
      method: "POST",
      token: "admin",
      body: update({ status: "monitoring", body: "It came back; still watching." }),
    });
    const reopened = await (await call("/v1/status")).json() as { incidents: Array<{ status: string; resolvedAt: number | null }> };
    expect(reopened.incidents[0]).toMatchObject({ status: "monitoring", resolvedAt: null });
  });
});

describe("the status view through a database outage", () => {
  it("serves the last good view, then an honest outage with nothing cached", async () => {
    const { readStatusViewResilient, forgetStatusViewForTest } = await import("../src/status.ts");
    forgetStatusViewForTest();
    let now = Date.parse("2026-10-20T12:00:00Z");
    let down = false;
    const store = {
      modelOutcomesSince: async () => { if (down) throw new Error("timeout"); return []; },
      listStatusIncidents: async () => { if (down) throw new Error("timeout"); return []; },
      listStatusIncidentUpdates: async () => [],
    } as never;
    const first = await readStatusViewResilient({ store, clock: { now: () => now } }, 30);
    expect(first.overall.state).toBe("operational");
    down = true;
    now += 120_000;
    const stale = await readStatusViewResilient({ store, clock: { now: () => now } }, 30);
    expect(stale.overall).toMatchObject({ state: "degraded", title: expect.stringContaining("delayed") });
    forgetStatusViewForTest();
    const dark = await readStatusViewResilient({ store, clock: { now: () => now } }, 30);
    expect(dark.overall).toMatchObject({ state: "outage", title: expect.stringContaining("database") });
  });
});

describe("which models the status page reports", () => {
  it("counts only the included catalog, never people's own keys or local models", async () => {
    const { readStatusView } = await import("../src/status.ts");
    const { DEFAULT_TAGFLOW_CONFIG } = await import("../src/tagflowConfig.ts");
    const model = { id: "", name: "", contextWindow: 131_072, maxOutput: 8192, inputPrice: 0, outputPrice: 0 };
    const now = Date.parse("2026-10-20T12:00:00Z");
    const today = "2026-10-20";
    const failing = (provider: string, model: string) => ({ day: today, provider, model, outcome: "server", count: 20, totalMs: 0 });
    const store = {
      modelOutcomesSince: async () => [
        { day: today, provider: "tagflow", model: "heabsy-qwen38", outcome: "ok", count: 20, totalMs: 20_000 },
        failing("ollama", "qwen2.5-coder:7b"),
        failing("openrouter", "openrouter/free"),
        failing("tagflow", "retired-model"),
      ],
      listStatusIncidents: async () => [],
      listStatusIncidentUpdates: async () => [],
      getTagflowConfig: async () => ({ config: { ...DEFAULT_TAGFLOW_CONFIG, defaultModel: "heabsy-qwen38", models: [{ ...model, id: "heabsy-qwen38", name: "Qwen 3.8" }, { ...model, id: "off", name: "Off", enabled: false }] }, updatedAt: 0, updatedBy: "admin" }),
    } as never;
    const view = await readStatusView({ store, clock: { now: () => now } }, 7);
    expect(view.models.map((model) => [model.model, model.name])).toEqual([["heabsy-qwen38", "Qwen 3.8"]]);
    expect(view.overall.state).toBe("operational");
  });
});
