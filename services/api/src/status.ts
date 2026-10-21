/**
 * The public status page: per-model health and the human-written incident log.
 *
 * Two questions, one page. "Are the models working?" is answered from the same daily
 * outcome counts the admin panel's Models page reads (`model_outcomes`, recorded by every
 * editor, no account attached). "What is anyone doing about it?" is answered by incidents
 * an administrator writes here - investigating, identified, monitoring, resolved -
 * because a bar turning yellow tells nobody whether a person knows.
 *
 * `GET /v1/status` serves `readStatusView` to the public page and the RSS feed; the admin
 * panel reads the same assembly so both sides describe one incident the same way. Nothing
 * here ever leaves a prompt, a reply, a file or an account attached to a number.
 *
 * The wire is deliberately pre-chewed: day states and percentages are computed once, in
 * one place, so the page, the feed and any future client cannot disagree about what
 * "degraded" means.
 */
import { utcDay, utcDayBefore } from "./day.ts";
import type { ModelOutcomeRow } from "./modelOutcomes.ts";
import { includedProvider, modelProvider } from "./includedProviders.ts";
import { parseTagflowConfig } from "./tagflowConfig.ts";
import type { TagflowConfigRecord } from "./tagflowTypes.ts";

export const STATUS_WINDOW_DAYS = 90;

/**
 * Below this many turns, an error rate is a rumour, not a signal. One failure in three
 * requests is 33% and means nothing; the same day is allowed to read "degraded" rather
 * than spend a red bar on a sample that small.
 */
export const STATUS_MIN_SAMPLE = 5;

export const STATUS_IMPACTS = ["none", "minor", "major", "critical", "maintenance"] as const;
export type StatusImpact = (typeof STATUS_IMPACTS)[number];

export const STATUS_STATES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type StatusState = (typeof STATUS_STATES)[number];

/** How a model, or one of its days, is coloured. `quiet` is no traffic - not a problem. */
export type StatusLevel = "operational" | "degraded" | "outage" | "maintenance" | "quiet";

export interface StatusIncidentRecord {
  incidentId: string;
  title: string;
  impact: StatusImpact;
  /** Mirrors the newest update, so the banner reads without a join. */
  status: StatusState;
  authorUid: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

export interface StatusIncidentUpdateRecord {
  updateId: string;
  incidentId: string;
  status: StatusState;
  body: string;
  authorUid: string;
  createdAt: number;
}

export interface StatusIncidentDraft {
  title: string;
  impact: StatusImpact;
  status: StatusState;
  body: string;
}

export interface StatusIncidentUpdateInput {
  status: StatusState;
  body: string;
}

export const MAX_STATUS_TITLE = 120;
export const MAX_STATUS_BODY = 2000;

const IMPACTS: ReadonlySet<string> = new Set(STATUS_IMPACTS);
const STATES: ReadonlySet<string> = new Set(STATUS_STATES);

/** Trimmed, non-empty, within the cap - or null. Same rule notices already use. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

export function parseIncidentDraft(raw: unknown): StatusIncidentDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const impact = r["impact"];
  if (typeof impact !== "string" || !IMPACTS.has(impact)) return null;
  const status = r["status"];
  if (typeof status !== "string" || !STATES.has(status)) return null;

  const title = text(r["title"], MAX_STATUS_TITLE);
  const body = text(r["body"], MAX_STATUS_BODY);
  if (title === null || body === null) return null;

  return { title, impact: impact as StatusImpact, status: status as StatusState, body };
}

export function parseIncidentUpdate(raw: unknown): StatusIncidentUpdateInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const status = r["status"];
  if (typeof status !== "string" || !STATES.has(status)) return null;
  const body = text(r["body"], MAX_STATUS_BODY);
  if (body === null) return null;

  return { status: status as StatusState, body };
}

/* ── Display names ───────────────────────────────────────────────────────── */

const PROVIDER_NAMES: Record<string, string> = {
  tagflow: "Tagflow AI",
  heabsy: "Heabsy",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  gemini: "Google",
  groq: "Groq",
  openrouter: "OpenRouter",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI",
  qwen: "Qwen",
  meta: "Meta",
};

export function providerDisplayName(provider: string): string {
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Words that read wrong title-cased: a model is "GPT", not "Gpt"; "VL", not "Vl". */
const INITIALISMS = ["gpt", "glm", "oss", "vl", "gguf", "ud", "ai", "llm", "q", "k"];

/** Brands whose own casing is not title case. */
const BRANDS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  mimo: "MiMo",
};

/**
 * Tag words that say how a model is served rather than what it is. `qwen2.5-coder:7b` keeps
 * its tag - the size is the identity - while `hacking:latest` and `beam:cloud` do not.
 */
const DELIVERY_WORDS = new Set(["latest", "cloud", "free", "preview"]);

const tokenize = (part: string): string[] => part.split(/[-_\s]+/).filter((token) => token.length > 0);

function tokenLabel(token: string): string {
  const lower = token.toLowerCase();
  if (INITIALISMS.includes(lower)) return lower.toUpperCase();
  // An initialism carrying a version: "glm53" -> "GLM53", "k2.7" -> "K2.7".
  if (INITIALISMS.some((word) => lower.startsWith(word) && /\d/.test(lower[word.length] ?? ""))) {
    return token.toUpperCase();
  }
  // Sizes and versions: "27b", "1.5b", "64k", "v4.1", "e4b".
  if (/^[0-9][0-9.]*[bkm]$/.test(lower)) return token.toUpperCase();
  if (/^[vd]\d/.test(lower)) return token.toUpperCase();
  if (/^[a-z]\d+[a-z]$/.test(lower)) return token.toUpperCase();
  return BRANDS[lower] ?? token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * A model id as a name a person recognises: `qwen2.5-coder:7b` reads "Qwen2.5 Coder 7B",
 * `nvidia/nemotron-3.5-super-vl:free` reads "Nemotron 3.5 Super VL". Derived rather than
 * mapped, because the catalogue is editable from the admin panel and a lookup table would
 * go stale the first time somebody adds a model upstream.
 *
 * Dots are kept - they are version numbers (`qwen2.5`, `V4.1`) - and a path segment that
 * only names a delivery (`openrouter/free`) falls back to the whole path, because a row
 * called "Free" says nothing about which model it is.
 */
export function modelDisplayName(model: string): string {
  const parts = model.split(":");
  const tag = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const head = (parts.length > 1 ? parts.slice(0, -1).join(":") : model).trim();
  const base = head.includes("/") ? head.slice(head.lastIndexOf("/") + 1) : head;

  const words = tokenize(base).map(tokenLabel);
  if (words.length === 0 || words.every((word) => DELIVERY_WORDS.has(word.toLowerCase()))) {
    // "openrouter/free": the path is the name. Consecutive repeats are collapsed, because
    // the provider is often also the first segment ("openrouter/openrouter/free").
    const whole = model.split(/[/:]+/).flatMap(tokenize).map(tokenLabel);
    const collapsed = whole.filter(
      (word, index) => index === 0 || word.toLowerCase() !== whole[index - 1]?.toLowerCase(),
    );
    return collapsed.length === 0 ? model : collapsed.join(" ");
  }

  const tagWords = tokenize(tag)
    .filter((token) => !DELIVERY_WORDS.has(token.toLowerCase()))
    .map(tokenLabel);
  return joinVersions([...words, ...tagWords]).join(" ");
}

/**
 * A version whose dots were dashes: "mistral-large-4-0" is Mistral Large 4.0, not "4 0".
 * Only a lone digit is joined, so "gemma-4-12B" stays two numbers.
 */
function joinVersions(words: string[]): string[] {
  const joined: string[] = [];
  for (const word of words) {
    const previous = joined[joined.length - 1];
    if (/^\d$/.test(word) && previous !== undefined && /^[A-Za-z]*\d+(\.\d+)?$/.test(previous)) {
      joined[joined.length - 1] = `${previous}.${word}`;
      continue;
    }
    joined.push(word);
  }
  return joined;
}

/* ── Assembly ────────────────────────────────────────────────────────────── */

export interface StatusDayView {
  day: string;
  level: StatusLevel;
  turns: number;
  errors: number;
  avgMs: number | null;
}

export interface StatusModelView {
  provider: string;
  /** The provider as a person reads it; shown beside the name, because one model id can
   *  reach ADCode through two providers. */
  providerName: string;
  model: string;
  name: string;
  /** The newest day with traffic - a quiet morning is not an outage. */
  state: StatusLevel;
  turns: number;
  ok: number;
  /** 0-100, two decimals. Null when nothing ran in the window. */
  uptimePct: number | null;
  errorPct: number | null;
  /** Average working-turn time over the last seven days, or null when none worked. */
  avgMs: number | null;
  lastActiveDay: string | null;
  days: StatusDayView[];
}

export interface StatusUpdateView {
  updateId: string;
  status: StatusState;
  body: string;
  createdAt: number;
}

export interface StatusIncidentView {
  incidentId: string;
  title: string;
  impact: StatusImpact;
  status: StatusState;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  /** Newest first, like the page reads them. */
  updates: StatusUpdateView[];
}

export interface StatusOverall {
  state: "operational" | "degraded" | "outage" | "maintenance";
  title: string;
  activeIncidents: number;
}

export interface StatusView {
  asOf: number;
  windowDays: number;
  overall: StatusOverall;
  models: StatusModelView[];
  incidents: StatusIncidentView[];
}

/** How one day of one model reads. Thresholds are the whole vocabulary, in one place. */
export function levelFor(errorPct: number, turns: number): StatusLevel {
  if (turns === 0) return "quiet";
  if (errorPct < 5) return "operational";
  if (errorPct >= 25 && turns >= STATUS_MIN_SAMPLE) return "outage";
  return "degraded";
}

/**
 * The turn endings that say the service failed. Everything else a turn can end with is the
 * person's own situation: signed out (`auth`), out of credit, a conversation too long for
 * the model, their own connection dropping, a reply cut at the limit they chose, a stop, or
 * an error nobody could classify. On 2026-10-20 counting those made every included model
 * read "outage" at 40-60% errors while the relay's own log had Tagflow Code 27B answering
 * 2,353 requests against 87 failures - signed-out turns alone were a third of the "errors".
 */
export const SERVICE_FAILURES: ReadonlySet<string> = new Set(["server", "rate_limit", "model_missing", "no_tools", "tool_format"]);

const round2 = (value: number): number => Math.round(value * 100) / 100;

interface DayTally {
  turns: number;
  errors: number;
  okMs: number;
  ok: number;
}

function blankDay(): DayTally {
  return { turns: 0, errors: 0, okMs: 0, ok: 0 };
}

/**
 * One pure function so the public page, the admin list and the tests cannot disagree.
 * Every input is already stored; nothing here reaches a store.
 */
export function assembleStatusView(args: {
  now: number;
  days: number;
  outcomes: readonly ModelOutcomeRow[];
  incidents: readonly StatusIncidentRecord[];
  updates: readonly StatusIncidentUpdateRecord[];
  /** Included models' own names and upstreams, so a row reads as the model picker does. */
  catalog?: StatusCatalog;
}): StatusView {
  const windowDays = Math.min(STATUS_WINDOW_DAYS, Math.max(7, Math.floor(args.days)));
  const dayKeys: string[] = [];
  for (let back = windowDays - 1; back >= 0; back -= 1) dayKeys.push(utcDayBefore(args.now, back));
  const windowStart = args.now - windowDays * 86_400_000;

  // provider:model -> day -> tally, and the seven-day ok time for the speed line.
  const series = new Map<string, { provider: string; model: string; days: Map<string, DayTally> }>();
  const last7 = new Set(dayKeys.slice(-7));
  for (const row of args.outcomes) {
    // Only an answer or the service's own failure is evidence about the model.
    if (row.outcome !== "ok" && !SERVICE_FAILURES.has(row.outcome)) continue;
    const key = `${row.provider}:${row.model}`;
    const entry = series.get(key) ?? { provider: row.provider, model: row.model, days: new Map<string, DayTally>() };
    const tally = entry.days.get(row.day) ?? blankDay();
    tally.turns += row.count;
    if (row.outcome === "ok") {
      tally.ok += row.count;
      tally.okMs += row.totalMs;
    } else {
      tally.errors += row.count;
    }
    entry.days.set(row.day, tally);
    series.set(key, entry);
  }

  const models: StatusModelView[] = [];
  for (const entry of series.values()) {
    let turns = 0;
    let ok = 0;
    let ok7Ms = 0;
    let ok7 = 0;
    let lastActiveDay: string | null = null;
    let lastDayLevel: StatusLevel = "quiet";

    const days: StatusDayView[] = dayKeys.map((day) => {
      const tally = entry.days.get(day) ?? blankDay();
      const errorPct = tally.turns === 0 ? 0 : (tally.errors / tally.turns) * 100;
      const level = levelFor(errorPct, tally.turns);
      turns += tally.turns;
      ok += tally.ok;
      if (last7.has(day) && tally.ok > 0) {
        ok7Ms += tally.okMs;
        ok7 += tally.ok;
      }
      if (tally.turns > 0) {
        lastActiveDay = day;
        lastDayLevel = level;
      }
      return {
        day,
        level,
        turns: tally.turns,
        errors: tally.errors,
        avgMs: tally.ok > 0 ? Math.round(tally.okMs / tally.ok) : null,
      };
    });

    if (turns === 0) continue; // a model nobody has used is not a status row
    const own = args.catalog?.get(entry.model);
    models.push({
      provider: entry.provider,
      providerName: own?.providerName ?? providerDisplayName(entry.provider),
      model: entry.model,
      name: own?.name ?? modelDisplayName(entry.model),
      state: lastDayLevel,
      turns,
      ok,
      uptimePct: round2((ok / turns) * 100),
      errorPct: round2(((turns - ok) / turns) * 100),
      avgMs: ok7 > 0 ? Math.round(ok7Ms / ok7) : null,
      lastActiveDay,
      days,
    });
  }
  models.sort(
    (a, b) => b.turns - a.turns || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
  );

  const incidents = buildIncidentViews(
    args.incidents.filter(
      (incident) => incident.status !== "resolved" || incident.createdAt >= windowStart,
    ),
    args.updates,
  );

  const active = incidents.filter((incident) => incident.status !== "resolved");
  const modelOutages = models.filter((model) => model.state === "outage").length;
  const modelDegraded = models.filter((model) => model.state === "degraded").length;

  let overall: StatusOverall;
  if (active.length > 0) {
    const rank: Record<StatusImpact, number> = { critical: 4, major: 3, minor: 2, maintenance: 1, none: 0 };
    const worst = [...active].sort(
      (a, b) => rank[b.impact] - rank[a.impact] || b.createdAt - a.createdAt,
    )[0]!;
    const state: StatusOverall["state"] =
      worst.impact === "critical" || worst.impact === "major"
        ? "outage"
        : worst.impact === "minor"
          ? "degraded"
          : "maintenance";
    overall = { state, title: worst.title, activeIncidents: active.length };
  } else if (modelOutages > 0) {
    overall = {
      state: "outage",
      title: modelOutages === 1 ? "One model is failing requests" : `${String(modelOutages)} models are failing requests`,
      activeIncidents: 0,
    };
  } else if (modelDegraded > 0) {
    overall = {
      state: "degraded",
      title: "Elevated error rates on some models",
      activeIncidents: 0,
    };
  } else {
    overall = { state: "operational", title: "All systems operational", activeIncidents: 0 };
  }

  return { asOf: args.now, windowDays, overall, models, incidents };
}

/** Newest first, with each incident's updates newest first. Shared by the public view and the admin list. */
export function buildIncidentViews(
  incidents: readonly StatusIncidentRecord[],
  updates: readonly StatusIncidentUpdateRecord[],
): StatusIncidentView[] {
  const byIncident = new Map<string, StatusUpdateView[]>();
  for (const update of updates) {
    const list = byIncident.get(update.incidentId) ?? [];
    list.push({ updateId: update.updateId, status: update.status, body: update.body, createdAt: update.createdAt });
    byIncident.set(update.incidentId, list);
  }
  for (const list of byIncident.values()) list.sort((a, b) => b.createdAt - a.createdAt);

  return [...incidents]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((incident) => ({
      incidentId: incident.incidentId,
      title: incident.title,
      impact: incident.impact,
      status: incident.status,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
      resolvedAt: incident.resolvedAt,
      updates: byIncident.get(incident.incidentId) ?? [],
    }));
}

/* ── Reads and writes ────────────────────────────────────────────────────── */

/** The part of the store this module needs - the same minimal-port style as modelOutcomes. */
export interface StatusStore {
  modelOutcomesSince(day: string): Promise<ModelOutcomeRow[]>;
  /** The included-AI catalog, for which models this page reports and what they are called. */
  getTagflowConfig?(): Promise<TagflowConfigRecord | null>;
  listStatusIncidents(): Promise<StatusIncidentRecord[]>;
  listStatusIncidentUpdates(): Promise<StatusIncidentUpdateRecord[]>;
  getStatusIncident(incidentId: string): Promise<StatusIncidentRecord | null>;
  createStatusIncident(incident: StatusIncidentRecord, firstUpdate: StatusIncidentUpdateRecord): Promise<void>;
  addStatusIncidentUpdate(incidentId: string, update: StatusIncidentUpdateRecord): Promise<boolean>;
  writeAudit(entry: { adminUid: string; action: string; subjectUid: string; at: number }): Promise<void>;
}

export async function readStatusView(
  deps: { store: StatusStore; clock: { now(): number } },
  days: number = STATUS_WINDOW_DAYS,
): Promise<StatusView> {
  const now = deps.clock.now();
  const windowDays = Math.min(STATUS_WINDOW_DAYS, Math.max(7, Math.floor(days)));
  const [outcomes, incidents, updates, catalog] = await Promise.all([
    deps.store.modelOutcomesSince(utcDayBefore(now, windowDays - 1)),
    deps.store.listStatusIncidents(),
    deps.store.listStatusIncidentUpdates(),
    // The catalog only names and narrows; without it the page still reports by provider.
    deps.store.getTagflowConfig?.().then(statusCatalog, () => null) ?? Promise.resolve(null),
  ]);
  return assembleStatusView({ now, days: windowDays, outcomes: includedOutcomes(outcomes, catalog), incidents, updates, catalog });
}

/**
 * The page reports ADCode's own included AI and nothing else. `model_outcomes` also counts
 * every model people run on their own keys and on their own machines - an Ollama model that
 * is not installed, an OpenRouter key out of credit - and those failures are theirs, not an
 * ADCode outage: on 2026-10-20 they read "15 models are failing requests" above a catalog of
 * four. With the catalog at hand, only its enabled models; without it, the included provider.
 */
export const STATUS_PROVIDER = "tagflow";

/** The enabled included models, by id, with the names the model picker shows. */
export type StatusCatalog = ReadonlyMap<string, { readonly name: string; readonly providerName: string }> | null;

export function statusCatalog(saved: TagflowConfigRecord | null): StatusCatalog {
  const config = saved === null ? null : parseTagflowConfig(saved.config);
  if (config === null) return null;
  return new Map(
    config.models
      .filter((model) => model.enabled !== false)
      .map((model) => [model.id, { name: model.name, providerName: includedProvider(modelProvider(model), config.providers)?.name ?? "Included AI" }]),
  );
}

export function includedOutcomes(outcomes: readonly ModelOutcomeRow[], catalog: StatusCatalog): ModelOutcomeRow[] {
  return outcomes.filter((row) => row.provider === STATUS_PROVIDER && (catalog === null || catalog.has(row.model)));
}

/** What the admin panel reads: every incident, resolved or not, same shapes as the public page. */
export async function handleListStatus(
  deps: { store: StatusStore; clock: { now(): number } },
  adminUid: string,
): Promise<{ incidents: StatusIncidentView[] }> {
  await deps.store.writeAudit({ adminUid, action: "read-status", subjectUid: "*", at: deps.clock.now() });
  const [incidents, updates] = await Promise.all([
    deps.store.listStatusIncidents(),
    deps.store.listStatusIncidentUpdates(),
  ]);
  return { incidents: buildIncidentViews(incidents, updates) };
}

export async function handleCreateStatusIncident(
  deps: { store: StatusStore; clock: { now(): number }; ids: { next(prefix: string): string } },
  adminUid: string,
  input: StatusIncidentDraft,
): Promise<StatusIncidentRecord> {
  const at = deps.clock.now();
  const incident: StatusIncidentRecord = {
    incidentId: deps.ids.next("inc"),
    title: input.title,
    impact: input.impact,
    status: input.status,
    authorUid: adminUid,
    createdAt: at,
    updatedAt: at,
    resolvedAt: input.status === "resolved" ? at : null,
  };
  const firstUpdate: StatusIncidentUpdateRecord = {
    updateId: deps.ids.next("incupd"),
    incidentId: incident.incidentId,
    status: input.status,
    body: input.body,
    authorUid: adminUid,
    createdAt: at,
  };

  await deps.store.writeAudit({ adminUid, action: `status:open:${incident.incidentId}`, subjectUid: "*", at });
  await deps.store.createStatusIncident(incident, firstUpdate);
  return incident;
}

/** Null when the incident does not exist. A resolved incident accepts updates - that is a reopen. */
export async function handleAddStatusIncidentUpdate(
  deps: { store: StatusStore; clock: { now(): number }; ids: { next(prefix: string): string } },
  adminUid: string,
  incidentId: string,
  input: StatusIncidentUpdateInput,
): Promise<StatusIncidentRecord | null> {
  const incident = await deps.store.getStatusIncident(incidentId);
  if (incident === null) return null;

  const at = deps.clock.now();
  const update: StatusIncidentUpdateRecord = {
    updateId: deps.ids.next("incupd"),
    incidentId,
    status: input.status,
    body: input.body,
    authorUid: adminUid,
    createdAt: at,
  };

  await deps.store.writeAudit({ adminUid, action: `status:update:${incidentId}`, subjectUid: "*", at });
  const applied = await deps.store.addStatusIncidentUpdate(incidentId, update);
  if (!applied) return null;

  return {
    ...incident,
    status: input.status,
    updatedAt: at,
    resolvedAt: input.status === "resolved" ? at : null,
  };
}

/* ── Staying up when the database is not ─────────────────────────────────── */

/**
 * The public view's last good copy, per isolate, served for up to a day while the database
 * cannot be reached (the edge already caches each answer for a minute). On 2026-10-19 the database hung and /v1/status
 * answered 500 for a day - a status page that goes dark exactly when something is wrong.
 */
let lastGood: { readonly at: number; readonly days: number; readonly view: StatusView } | null = null;

export async function readStatusViewResilient(
  deps: { store: StatusStore; clock: { now(): number } },
  days: number = STATUS_WINDOW_DAYS,
): Promise<StatusView> {
  const now = deps.clock.now();
  try {
    const view = await readStatusView(deps, days);
    lastGood = { at: now, days, view };
    return view;
  } catch {
    if (lastGood !== null && now - lastGood.at < 86_400_000) {
      return { ...lastGood.view, overall: { ...lastGood.view.overall, state: "degraded", title: "Live figures are delayed - showing the last update we have" } };
    }
    // Nothing to show but the truth: the figures live in the store that is not answering.
    return {
      asOf: now,
      windowDays: days,
      overall: { state: "outage", title: "Service disruption - our database is not responding", activeIncidents: 0 },
      models: [],
      incidents: [],
    };
  }
}

/** Tests only. */
export function forgetStatusViewForTest(): void { lastGood = null; }
