/**
 * OpenAI-style plugins and actions: an OpenAPI description, turned into callable tools.
 *
 * ChatGPT plugins (`ai-plugin.json` + an OpenAPI URL) and today's GPT Actions both
 * describe a REST API. This module reads that description and answers with the two
 * halves a connector needs: a tool list in the shape the rest of ADCode already speaks
 * (name, description, JSON Schema), and a builder that turns a tool call plus the
 * person's arguments into one HTTP request.
 *
 * Pure: the spec text goes in, requests come out, nothing is sent from here. The epoch
 * this supports is OpenAPI 3.x, plus Swagger 2.0 because that is what the older plugin
 * specs in the wild still are.
 */
import type { DraftAuth } from "./types.ts";

type Json = Record<string, unknown>;

export interface OpenApiParameter {
  readonly name: string;
  readonly location: "path" | "query" | "header";
  /** The property this parameter takes in the merged input object (may be renamed to avoid a clash). */
  readonly property: string;
  readonly required: boolean;
  readonly schema: Json;
  readonly description: string;
  readonly explode: boolean;
}

export interface OpenApiBody {
  readonly kind: "json" | "form";
  readonly required: boolean;
  /** The body's own properties, when it is an object, each with its input-object property name. */
  readonly properties: readonly { readonly property: string; readonly schema: Json; readonly required: boolean }[];
  /** A non-object body: the whole value arrives under this property's name. */
  readonly whole: string | null;
  readonly schema: Json;
}

export interface OpenApiOperation {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly description: string;
  readonly inputSchema: Json;
  readonly parameters: readonly OpenApiParameter[];
  readonly body: OpenApiBody | null;
}

export interface ParsedOpenApi {
  readonly title: string;
  readonly version: string;
  readonly baseUrl: string | null;
  readonly operations: readonly OpenApiOperation[];
  readonly warnings: readonly string[];
}

const record = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
const bounded = (value: unknown, limit: number): string => (typeof value === "string" ? value.trim().slice(0, limit) : "");

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;
const MAX_DEPTH = 8;
const MAX_OPERATIONS = 200;
const MAX_PARAMETERS = 40;

/* ── Reading the document ──────────────────────────────────────────────────── */

function resolveRef(root: Json, ref: string, seen: ReadonlySet<string>): Json | null {
  if (!ref.startsWith("#/")) return null;
  if (seen.has(ref)) return null;
  let at: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    const step = record(at);
    if (step === null) return null;
    at = step[decodeURIComponent(segment.replaceAll("~1", "/").replaceAll("~0", "~"))];
  }
  return record(at);
}

/** A JSON Schema subset, with $refs followed and OpenAPI-only words dropped. */
function normalizeSchema(root: Json, schema: unknown, depth: number, seen: ReadonlySet<string>): Json {
  const value = record(schema);
  if (value === null || depth > MAX_DEPTH) return {};
  const ref = typeof value["$ref"] === "string" ? value["$ref"] : null;
  if (ref !== null) {
    const target = resolveRef(root, ref, seen);
    if (target === null) return { type: "object", additionalProperties: true, description: "Recursive or unresolved reference." };
    const next = new Set(seen);
    next.add(ref);
    const resolved = normalizeSchema(root, target, depth + 1, next);
    const overrideDescription = bounded(value["description"], 500);
    return overrideDescription === "" ? resolved : { ...resolved, description: overrideDescription };
  }

  const out: Json = {};
  for (const key of ["title", "description", "default", "enum", "const", "format", "pattern", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "multipleOf", "examples"] as const) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  if (typeof out["description"] === "string") out["description"] = out["description"].slice(0, 500);
  if (typeof out["title"] === "string") out["title"] = out["title"].slice(0, 200);

  const type = value["type"];
  let types: string[] = typeof type === "string" ? [type] : Array.isArray(type) ? type.filter((item): item is string => typeof item === "string") : [];
  if (value["nullable"] === true && types.length > 0 && !types.includes("null")) types = [...types, "null"];
  if (types.length === 1) out["type"] = types[0];
  else if (types.length > 1) out["type"] = types;

  const schemaType = types.find(item => item !== "null") ?? "";
  if (schemaType === "object") {
    const properties = record(value["properties"]);
    if (properties !== null) {
      const normalized: Json = {};
      for (const [name, child] of Object.entries(properties)) normalized[name] = normalizeSchema(root, child, depth + 1, seen);
      if (Object.keys(normalized).length > 0) out["properties"] = normalized;
    }
    const required = Array.isArray(value["required"]) ? value["required"].filter((item): item is string => typeof item === "string") : [];
    if (required.length > 0) out["required"] = required;
    if (value["additionalProperties"] !== undefined || Object.keys(record(value["properties"]) ?? {}).length === 0) {
      out["additionalProperties"] = value["additionalProperties"] === true ? true : Object.keys(record(value["properties"]) ?? {}).length === 0 ? true : false;
    }
  }
  if (schemaType === "array") out["items"] = normalizeSchema(root, value["items"] ?? {}, depth + 1, seen);
  if (Array.isArray(value["allOf"]) && value["allOf"].length > 0) {
    /*
     * allOf is flattened rather than kept: its common use is a base schema plus
     * overrides, and a model reads one merged object better than a chain of parts.
     * Everything but `properties` shallow-merges in order; property maps combine.
     */
    let merged: Json = {};
    let properties: Json = {};
    for (const part of value["allOf"]) {
      const normalized = normalizeSchema(root, part, depth + 1, seen);
      const partProperties = record(normalized["properties"]);
      const rest = { ...normalized };
      delete rest["properties"];
      merged = { ...merged, ...rest };
      if (partProperties !== null) properties = { ...properties, ...partProperties };
    }
    const combined: Json = { ...merged, ...out };
    const allProperties = { ...properties, ...(record(out["properties"]) ?? {}) };
    if (Object.keys(allProperties).length > 0) combined["properties"] = allProperties;
    return combined;
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(value[key])) out[key] = (value[key] as unknown[]).slice(0, 20).map(part => normalizeSchema(root, part, depth + 1, seen));
  }
  if (out["type"] === undefined && out["oneOf"] === undefined && out["anyOf"] === undefined && out["properties"] === undefined) out["type"] = "object";
  return out;
}

/** Swagger 2.0 writes parameters inline: `{ name, in, type, items }`. Rebuild a schema. */
function swaggerParameterSchema(parameter: Json): Json {
  if (record(parameter["schema"]) !== null) return parameter["schema"] as Json;
  const schema: Json = {};
  for (const key of ["type", "format", "enum", "default", "minimum", "maximum", "pattern", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems"] as const) {
    if (parameter[key] !== undefined) schema[key] = parameter[key];
  }
  if (record(parameter["items"]) !== null) schema["items"] = swaggerParameterSchema(parameter["items"] as Json);
  return schema;
}

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function sanitizeOperationId(raw: string): string {
  let name = raw.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+/, "").slice(0, 64).replace(/_+$/, "");
  if (name === "") return "call";
  if (!/^[A-Za-z_]/.test(name)) name = `call_${name}`.slice(0, 64);
  return TOOL_NAME.test(name) ? name : "call";
}

export function operationNameFrom(method: string, path: string): string {
  const segments = path.split("/").filter(segment => segment !== "").map(segment => segment.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_"));
  return sanitizeOperationId([method.toLowerCase(), ...segments].join("_"));
}

export interface ParseOpenApiOptions {
  /** The URL the spec was fetched from, used to resolve a relative server URL. */
  readonly documentUrl?: string;
}

/** The whole document, read once. Throws with a sentence when it is not an OpenAPI description. */
export function parseOpenApi(text: string, options: ParseOpenApiOptions = {}): ParsedOpenApi {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The API description is not valid JSON. OpenAPI files written in YAML are not read yet - convert it to JSON first.");
  }
  const root = record(parsed);
  if (root === null) throw new Error("The API description must be a JSON object.");
  const isSwagger = typeof root["swagger"] === "string";
  const version = isSwagger ? String(root["swagger"]) : bounded(root["openapi"], 16);
  if (!isSwagger && !version.startsWith("3.")) throw new Error("This is not an OpenAPI 3 or Swagger 2 description (no openapi or swagger field).");
  const paths = record(root["paths"]);
  if (paths === null) throw new Error("The API description lists no paths.");

  const info = record(root["info"]);
  const warnings: string[] = [];

  /* Base URL: servers[] (3.x) or scheme://host/basePath (2.0); server variables take their defaults. */
  let baseUrl: string | null = null;
  if (isSwagger) {
    const host = bounded(root["host"], 2048);
    const scheme = Array.isArray(root["schemes"]) && typeof root["schemes"][0] === "string" ? (root["schemes"][0] as string) : "https";
    if (host !== "") baseUrl = `${scheme}://${host}${bounded(root["basePath"], 1024)}`;
  } else if (Array.isArray(root["servers"]) && record(root["servers"][0]) !== null) {
    const server = record(root["servers"][0])!;
    let url = bounded(server["url"], 2048);
    const variables = record(server["variables"]);
    if (variables !== null) {
      url = url.replace(/\{([^}]+)\}/g, (whole, name: string) => {
        const variable = record(variables[name]);
        return variable !== null && typeof variable["default"] === "string" ? variable["default"] : whole;
      });
    }
    baseUrl = url !== "" ? url : null;
  }
  if (baseUrl !== null && !/^https?:/i.test(baseUrl)) {
    // A relative server URL (or a bare "/") is only usable when we know where the document came from.
    if (options.documentUrl === undefined) baseUrl = null;
    else {
      try {
        const resolvedBase = new URL(baseUrl, options.documentUrl);
        baseUrl = /^https?:/.test(resolvedBase.origin) ? resolvedBase.toString() : null;
      } catch {
        baseUrl = null;
      }
    }
  }

  const operations: OpenApiOperation[] = [];
  const usedNames = new Set<string>();
  let skippedBodies = 0;
  let skippedPaths = 0;

  for (const [path, pathValue] of Object.entries(paths)) {
    if (operations.length >= MAX_OPERATIONS) { skippedPaths++; continue; }
    const pathItem = record(pathValue);
    if (pathItem === null || !path.startsWith("/")) { skippedPaths++; continue; }
    // Path-level parameters apply to every operation under them.
    const sharedParameters = Array.isArray(pathItem["parameters"]) ? (pathItem["parameters"] as unknown[]) : [];
    for (const method of METHODS) {
      const operation = record(pathItem[method]);
      if (operation === null) continue;
      if (operations.length >= MAX_OPERATIONS) { skippedPaths++; continue; }

      const declaredName = bounded(operation["operationId"], 80);
      let name = declaredName !== "" ? sanitizeOperationId(declaredName) : operationNameFrom(method, path);
      if (usedNames.has(name)) {
        let index = 2;
        while (usedNames.has(`${name}_${index.toString()}`)) index++;
        name = `${name}_${index.toString()}`;
      }
      usedNames.add(name);

      const parameters: OpenApiParameter[] = [];
      const seenProperties = new Set<string>();
      const rawParameters = [...sharedParameters, ...(Array.isArray(operation["parameters"]) ? (operation["parameters"] as unknown[]) : [])];
      for (const raw of rawParameters.slice(0, MAX_PARAMETERS)) {
        let parameter = record(raw);
        if (parameter === null) continue;
        const ref = typeof parameter["$ref"] === "string" ? parameter["$ref"] : null;
        if (ref !== null) {
          const target = resolveRef(root, ref, new Set());
          if (target === null) continue;
          parameter = target;
        }
        const where = bounded(parameter["in"], 16);
        if (where !== "path" && where !== "query" && where !== "header") continue; // cookies and Swagger formData are handled elsewhere or not at all
        const paramName = bounded(parameter["name"], 128);
        if (paramName === "") continue;
        const schema = isSwagger ? normalizeSchema(root, swaggerParameterSchema(parameter), 0, new Set()) : normalizeSchema(root, parameter["schema"] ?? {}, 0, new Set());
        let property = paramName;
        if (seenProperties.has(property)) property = `${where}_${paramName}`;
        if (seenProperties.has(property)) continue;
        seenProperties.add(property);
        const explode = typeof parameter["explode"] === "boolean" ? (parameter["explode"] as boolean) : true;
        parameters.push({
          name: paramName,
          location: where,
          property,
          required: where === "path" || parameter["required"] === true,
          schema,
          description: bounded(parameter["description"], 500),
          explode,
        });
      }

      /* The request body. Swagger 2.0 hides it among the parameters; 3.x names it. */
      let bodyKind: "json" | "form" | null = null;
      let bodySchema: Json | null = null;
      let bodyRequired = false;
      if (isSwagger) {
        const bodies = rawParameters.map(record).filter((item): item is Json => item !== null && item["in"] === "body");
        const forms = rawParameters.map(record).filter((item): item is Json => item !== null && item["in"] === "formData");
        const body = bodies[0];
        if (body && record(body["schema"]) !== null) { bodySchema = body["schema"] as Json; bodyKind = "json"; bodyRequired = body["required"] === true; }
        else if (forms.length > 0) {
          bodyKind = "form";
          bodyRequired = forms.some(form => form["required"] === true);
          bodySchema = { type: "object", properties: Object.fromEntries(forms.map(form => [String(form["name"] ?? ""), swaggerParameterSchema(form)])), required: forms.filter(form => form["required"] === true).map(form => String(form["name"] ?? "")) };
        }
      } else {
        const requestBody = record(operation["requestBody"]);
        if (requestBody !== null) {
          const content = record(requestBody["content"]);
          let json: Json | null = content === null ? null : record(content["application/json"]);
          if (json === null && content !== null) {
            for (const [type, value] of Object.entries(content)) {
              if (!type.includes("json")) continue;
              json = record(value);
              if (json !== null) break;
            }
          }
          const form = content === null ? null : record(content["application/x-www-form-urlencoded"]);
          if (json !== null && json["schema"] !== undefined) { bodySchema = json["schema"] as Json; bodyKind = "json"; bodyRequired = requestBody["required"] === true; }
          else if (form !== null && form["schema"] !== undefined) { bodySchema = form["schema"] as Json; bodyKind = "form"; bodyRequired = requestBody["required"] === true; }
          else if (content !== null && Object.keys(content).length > 0) {
            // multipart and binary bodies carry files ADCode's text-only tool call cannot build.
            skippedBodies++;
            continue;
          }
        }
      }

      let body: OpenApiBody | null = null;
      if (bodySchema !== null && bodyKind !== null) {
        const normalized = normalizeSchema(root, bodySchema, 0, new Set());
        const properties = record(normalized["properties"]);
        const requiredProps = new Set(Array.isArray(normalized["required"]) ? (normalized["required"] as unknown[]).filter((item): item is string => typeof item === "string") : []);
        const isObject = typesOf(normalized).includes("object") || properties !== null;
        if (isObject && properties !== null && Object.keys(properties).length > 0) {
          const entries: { property: string; schema: Json; required: boolean }[] = [];
          for (const [propName, schema] of Object.entries(properties)) {
            let property = propName;
            if (seenProperties.has(property)) property = `body_${propName}`;
            if (seenProperties.has(property)) { warnings.push(`${method.toUpperCase()} ${path}: dropped body field ${propName}, its name is already taken.`); continue; }
            seenProperties.add(property);
            entries.push({ property, schema: schema as Json, required: requiredProps.has(propName) });
          }
          body = { kind: bodyKind, required: bodyRequired, properties: entries, whole: null, schema: normalized };
        } else {
          const property = seenProperties.has("body") ? "request_body" : "body";
          seenProperties.add(property);
          body = { kind: bodyKind, required: bodyRequired, properties: [], whole: property, schema: normalized };
        }
      }

      const properties: Json = {};
      const required: string[] = [];
      for (const parameter of parameters) {
        if (parameter.schema["type"] === undefined && parameter.schema["oneOf"] === undefined && parameter.schema["anyOf"] === undefined && parameter.schema["enum"] === undefined) parameter.schema["type"] = "string";
        properties[parameter.property] = parameter.description !== "" && parameter.schema["description"] === undefined ? { ...parameter.schema, description: parameter.description } : parameter.schema;
        if (parameter.required) required.push(parameter.property);
      }
      for (const entry of body?.properties ?? []) {
        properties[entry.property] = entry.schema;
        if (entry.required) required.push(entry.property);
      }
      if (body?.whole !== null && body !== null) {
        properties[body.whole] = body.schema;
        if (body.required) required.push(body.whole);
      }

      const summary = bounded(operation["summary"], 300);
      const detail = bounded(operation["description"], 700);
      const description = [`${method.toUpperCase()} ${path}`, summary, detail].filter(part => part !== "").join(" - ").slice(0, 1024);
      operations.push({
        name,
        method: method.toUpperCase(),
        path,
        description,
        parameters,
        body,
        inputSchema: { type: "object", properties, ...(required.length > 0 ? { required } : {}) },
      });
    }
  }
  if (operations.length === 0) throw new Error("The API description lists no callable operations.");
  if (skippedPaths > 0) warnings.push(`${skippedPaths.toString()} operation${skippedPaths === 1 ? "" : "s"} were beyond the ${MAX_OPERATIONS.toString()} ADCode reads.`);
  if (skippedBodies > 0) warnings.push(`${skippedBodies.toString()} operation${skippedBodies === 1 ? " was" : "s were"} skipped: file uploads and other non-JSON bodies are not supported.`);
  if (baseUrl === null) warnings.push("The description names no server address; give one when adding it.");
  const security = Array.isArray(root["security"]) && record(root["security"][0]) !== null ? record(root["security"][0])! : null;
  if (security !== null) warnings.push("The API declares security schemes; if calls fail with 401, add a token.");

  return {
    title: bounded(info?.["title"], 100) || "API",
    version: bounded(info?.["version"], 32),
    baseUrl,
    operations,
    warnings,
  };
}

function typesOf(schema: Json): string[] {
  const type = schema["type"];
  if (typeof type === "string") return [type];
  return Array.isArray(type) ? type.filter((item): item is string => typeof item === "string") : [];
}

/** The tool list the connector exposes, in ADCode's existing tool shape. */
export function openApiTools(doc: ParsedOpenApi): readonly { readonly name: string; readonly description: string; readonly inputSchema: Json }[] {
  return doc.operations.map(operation => ({ name: operation.name, description: operation.description, inputSchema: operation.inputSchema }));
}

/* ── Building one call ─────────────────────────────────────────────────────── */

export interface OpenApiCallContext {
  readonly baseUrl: string;
  readonly auth: DraftAuth | null;
  readonly token: string | null;
}

export interface OpenApiRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

const scalar = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value));

/**
 * One operation plus the model's arguments, as an HTTP request.
 *
 * Throws with a sentence when a required argument is missing or the base URL cannot
 * hold together - both are things the model can read and correct on the next call.
 */
export function buildOperationRequest(operation: OpenApiOperation, args: Json, context: OpenApiCallContext): OpenApiRequest {
  const base = context.baseUrl.replace(/\/+$/, "");
  const query: string[] = [];
  const headers: Record<string, string> = {};

  let path = operation.path;
  for (const parameter of operation.parameters) {
    const value = args[parameter.property];
    if (parameter.location === "path") {
      if (value === undefined || value === null || value === "") throw new Error(`Missing value for path parameter ${parameter.name}.`);
      path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(scalar(value)));
      continue;
    }
    if (value === undefined || value === null) {
      if (parameter.required) throw new Error(`Missing required argument ${parameter.property}.`);
      continue;
    }
    if (parameter.location === "header") {
      headers[parameter.name] = scalar(value);
      continue;
    }
    if (Array.isArray(value)) {
      if (parameter.explode) for (const item of value) query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(scalar(item))}`);
      else query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(value.map(scalar).join(","))}`);
    } else if (typeof value === "object") {
      query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(JSON.stringify(value))}`);
    } else {
      query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(scalar(value))}`);
    }
  }

  let body: string | null = null;
  if (operation.body !== null) {
    if (operation.body.whole !== null) {
      const value = args[operation.body.whole];
      if (value === undefined) {
        if (operation.body.required) throw new Error(`Missing required argument ${operation.body.whole}.`);
      } else if (operation.body.kind === "form") {
        body = new URLSearchParams(Object.entries(record(value) ?? {}).map(([key, item]) => [key, scalar(item)])).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else {
        body = JSON.stringify(value);
        headers["Content-Type"] = "application/json";
      }
    } else {
      const assembled: Record<string, unknown> = {};
      let any = false;
      for (const entry of operation.body.properties) {
        const value = args[entry.property];
        if (value === undefined) {
          if (entry.required) throw new Error(`Missing required argument ${entry.property}.`);
          continue;
        }
        assembled[entry.property] = value;
        any = true;
      }
      if (any || operation.body.required) {
        if (operation.body.kind === "form") {
          body = new URLSearchParams(Object.entries(assembled).map(([key, item]) => [key, scalar(item)])).toString();
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        } else {
          body = JSON.stringify(assembled);
          headers["Content-Type"] = "application/json";
        }
      }
    }
  }

  if (context.auth !== null && context.auth.needsToken && context.token !== null) {
    if (context.auth.kind === "bearer") headers["Authorization"] = `Bearer ${context.token}`;
    else if (context.auth.kind === "header" && context.auth.name !== null && isHeaderName(context.auth.name)) headers[context.auth.name] = context.token;
    else if (context.auth.kind === "query" && context.auth.name !== null) query.push(`${encodeURIComponent(context.auth.name)}=${encodeURIComponent(context.token)}`);
  }

  return { url: `${base}${path}${query.length > 0 ? `?${query.join("&")}` : ""}`, method: operation.method, headers, body };
}

/** A header name that cannot smuggle a second header or trip Node's own validation. */
export function isHeaderName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name) && !/^(host|content-length|connection|transfer-encoding)$/i.test(name);
}

/**
 * An HTTP answer as one tool result.
 *
 * The status line always leads, because "404" is the single most useful thing the model
 * can see; the body follows, pretty-printed when it is JSON.
 */
export function renderHttpResult(status: number, statusText: string, contentType: string, body: string): { readonly content: string; readonly isError: boolean } {
  const statusLine = `HTTP ${status.toString()}${statusText !== "" ? ` ${statusText}` : ""}`;
  const trimmed = body.trim();
  let display = trimmed;
  if (trimmed === "") display = "(empty response)";
  else if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      display = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      display = trimmed;
    }
  }
  return { content: `${statusLine}\n${display}`, isError: status >= 400 || status === 0 };
}
