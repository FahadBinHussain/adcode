/**
 * ChatGPT plugins: `ai-plugin.json` beside an OpenAPI description.
 *
 * OpenAI calls the modern version "actions" and no longer asks for the manifest, but the
 * manifest is what says how to authenticate and how the plugin wants to be named, and
 * plenty of published plugins still ship one. Read it, then pair it with the spec.
 */
import { BASE_URL_KEY, slugify, type ConnectorDraft, type DraftAuth, type DraftValue } from "./types.ts";
import type { ParsedOpenApi } from "./openapi.ts";

export interface AiPluginManifest {
  readonly nameForModel: string;
  readonly nameForHuman: string;
  readonly descriptionForModel: string;
  readonly descriptionForHuman: string;
  readonly apiUrl: string;
  readonly auth: DraftAuth;
  readonly logoUrl: string | null;
  readonly legalInfoUrl: string | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown, limit: number): string => (typeof value === "string" ? value.trim().slice(0, limit) : "");

/**
 * The manifest as a value, or an error in plain words.
 *
 * `sourceUrl` is where the manifest was read from, used to finish a relative `api.url`;
 * ChatGPT in the wild always wrote absolute ones, but hand-written manifests sometimes
 * do not.
 */
export function parseAiPlugin(json: string, sourceUrl: string | null): AiPluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("ai-plugin.json is not valid JSON.");
  }
  const root = record(parsed);
  if (root === null) throw new Error("ai-plugin.json must be a JSON object.");
  const nameForModel = text(root["name_for_model"], 64);
  if (nameForModel === "") throw new Error("The plugin manifest has no name_for_model.");
  const api = record(root["api"]);
  if (api === null || text(api["url"], 2_048) === "") throw new Error("The plugin manifest has no api.url pointing at its OpenAPI description.");
  if (api["type"] !== undefined && api["type"] !== "openapi") throw new Error(`The plugin describes its API as "${String(api["type"])}"; only OpenAPI plugins are read.`);
  let apiUrl = text(api["url"], 2_048);
  if (!/^https?:/i.test(apiUrl)) {
    if (sourceUrl === null) throw new Error("The plugin's api.url is relative, and the manifest was not read from a URL.");
    try {
      apiUrl = new URL(apiUrl, sourceUrl).toString();
    } catch {
      throw new Error("The plugin's api.url cannot be resolved.");
    }
  }

  const auth = record(root["auth"]);
  const authType = auth === null ? "none" : text(auth["type"], 32) || "none";
  let reduced: DraftAuth;
  switch (authType) {
    case "none":
      reduced = { kind: "none", name: null, needsToken: false };
      break;
    case "service_http":
    case "user_http":
      // Both are "the person supplies a token"; ChatGPT sent service_http tokens as a bearer header.
      reduced = { kind: "bearer", name: null, needsToken: true };
      break;
    case "oauth":
      // ADCode does not run per-plugin OAuth; a token the person already has still works.
      reduced = { kind: "bearer", name: null, needsToken: true };
      break;
    default:
      reduced = { kind: "none", name: null, needsToken: false };
  }

  return {
    nameForModel,
    nameForHuman: text(root["name_for_human"], 100) || nameForModel,
    descriptionForModel: text(root["description_for_model"], 700),
    descriptionForHuman: text(root["description_for_human"], 500),
    apiUrl,
    auth: reduced,
    logoUrl: text(root["logo_url"], 2_048) || null,
    legalInfoUrl: text(root["legal_info_url"], 2_048) || null,
  };
}

/** The draft the Add dialog shows for a plugin manifest plus its spec. */
export function aiPluginDraft(manifest: AiPluginManifest, specText: string, doc: ParsedOpenApi, source: string): ConnectorDraft {
  const warnings: string[] = [...doc.warnings];
  if (manifest.auth.kind === "bearer") warnings.push("This plugin needs a token. Create one with the service, then paste it here - it goes to the encrypted store.");
  const values: DraftValue[] = [];
  if (manifest.auth.needsToken) values.push({ key: "token", label: "API token", hint: "From the plugin's own website.", required: true, secret: true, preset: null });
  if (doc.baseUrl === null) values.push({ key: BASE_URL_KEY, label: "Server address", hint: "The description names no server address, so give the address requests go to.", required: true, secret: false, preset: null });
  return {
    kind: "openapi",
    name: manifest.nameForHuman,
    slug: slugify(manifest.nameForModel, "plugin"),
    purpose: manifest.descriptionForHuman || manifest.descriptionForModel || `An OpenAPI plugin with ${doc.operations.length.toString()} callable operation${doc.operations.length === 1 ? "" : "s"}.`,
    source,
    origin: "actions",
    transport: "http",
    endpoint: doc.baseUrl ?? "",
    args: [],
    env: {},
    headers: {},
    values,
    spec: specText,
    auth: manifest.auth,
    skills: [],
    servers: [],
    warnings,
    homepage: manifest.legalInfoUrl,
  };
}

/** A draft from an OpenAPI description alone - today's GPT Actions shape. */
export function actionsDraft(specText: string, doc: ParsedOpenApi, source: string, name: string | null): ConnectorDraft {
  const values: DraftValue[] = [];
  if (doc.baseUrl === null) values.push({ key: BASE_URL_KEY, label: "Server address", hint: "The description names no server address, so give the address requests go to.", required: true, secret: false, preset: null });
  return {
    kind: "openapi",
    name: name ?? doc.title,
    slug: slugify(name ?? doc.title, "actions"),
    purpose: `Calls ${doc.title}${doc.version !== "" ? ` ${doc.version}` : ""} directly: ${doc.operations.length.toString()} operation${doc.operations.length === 1 ? "" : "s"}${doc.operations[0] ? `, starting with ${doc.operations[0].name}` : ""}.`,
    source,
    origin: "actions",
    transport: "http",
    endpoint: doc.baseUrl ?? "",
    args: [],
    env: {},
    headers: {},
    values,
    spec: specText,
    auth: { kind: "none", name: null, needsToken: false },
    skills: [],
    servers: [],
    warnings: [...doc.warnings],
    homepage: null,
  };
}
