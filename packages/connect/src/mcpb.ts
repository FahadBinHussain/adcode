/**
 * Claude Desktop extensions (`.mcpb`, formerly `.dxt`).
 *
 * A desktop extension is a zip that holds a `manifest.json`, the server's own files,
 * and - the part that matters for importing - a description of how to start it and
 * which settings it needs from the person. This module reads that manifest and reduces
 * it to a draft plus the questions its `user_config` asks. Unpacking the zip and
 * substituting the answers happens where the files are written, using the helpers here.
 *
 * Reference: the extension manifest spec (manifest_version 0.1-0.3).
 */
import { isEnvName, slugify, type ConnectorDraft, type DraftValue } from "./types.ts";

export interface McpbUserField {
  readonly key: string;
  readonly type: "string" | "number" | "boolean" | "directory" | "file";
  readonly title: string;
  readonly description: string;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly preset: string | null;
}

export interface McpbManifest {
  readonly manifestVersion: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly homepage: string | null;
  readonly serverType: "node" | "python" | "binary";
  readonly entryPoint: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly userConfig: readonly McpbUserField[];
  /** Names the extension says it adds, for the card, when it bothered to list them. */
  readonly toolNames: readonly string[];
}

const MANIFEST_VERSIONS = new Set(["0.1", "0.2", "0.3"]);
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const boundedText = (value: unknown, limit: number): string => text(value).trim().slice(0, limit);

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** The manifest as a value, or an error in plain words. Never partially trusted. */
export function parseMcpbManifest(json: string): McpbManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The extension's manifest.json is not valid JSON.");
  }
  const root = record(parsed);
  if (root === null) throw new Error("The extension's manifest.json must be a JSON object.");
  const manifestVersion = text(root["manifest_version"]);
  if (!MANIFEST_VERSIONS.has(manifestVersion)) {
    throw new Error(`This extension uses manifest version ${manifestVersion || "(missing)"}; ADCode reads 0.1 to 0.3.`);
  }
  const name = text(root["name"]);
  if (!NAME_PATTERN.test(name) || name.length > 64) throw new Error("The extension needs a lowercase name of letters, digits, hyphens or underscores.");
  const version = text(root["version"]).trim();
  if (version === "" || version.length > 32) throw new Error("The extension needs a version.");

  const server = record(root["server"]);
  if (server === null) throw new Error("The extension's manifest has no server section, so there is nothing to start.");
  const serverType = text(server["type"]);
  if (serverType !== "node" && serverType !== "python" && serverType !== "binary") {
    throw new Error(`The extension runs a "${serverType || "missing"}" server; ADCode reads node, python and binary servers.`);
  }
  const entryPoint = text(server["entry_point"]).replace(/^\.\//, "");
  if (entryPoint === "" || entryPoint.startsWith("/") || entryPoint.includes("\\") || entryPoint.split("/").includes("..")) {
    throw new Error("The extension's entry point must be a relative file inside the extension.");
  }
  const config = record(server["mcp_config"]);
  if (config === null) throw new Error("The extension's manifest has no mcp_config, so ADCode cannot start it.");
  const command = boundedText(config["command"], 2_048);
  if (command === "") throw new Error("The extension's mcp_config has no command.");

  const args: string[] = [];
  if (config["args"] !== undefined) {
    if (!Array.isArray(config["args"])) throw new Error("The extension's mcp_config arguments must be a list.");
    for (const arg of config["args"]) {
      if (typeof arg !== "string") throw new Error("The extension's mcp_config arguments must be text.");
      args.push(arg);
    }
    if (args.length > 40) throw new Error("The extension's mcp_config has more than 40 arguments.");
  }
  const env: Record<string, string> = {};
  const envRecord = record(config["env"] ?? {});
  if (envRecord !== null) {
    for (const [key, value] of Object.entries(envRecord)) {
      if (!isEnvName(key)) throw new Error(`The extension sets an environment name ADCode cannot use: ${key}`);
      if (typeof value === "string" && value.length <= 4_096) env[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") env[key] = String(value);
      else throw new Error(`The extension's ${key} value must be text.`);
    }
  }

  const userConfig: McpbUserField[] = [];
  const userRecord = record(root["user_config"] ?? {});
  if (userRecord !== null) {
    for (const [key, raw] of Object.entries(userRecord)) {
      const field = record(raw);
      if (field === null || !isEnvName(key)) throw new Error(`The extension's user_config has an entry ADCode cannot use: ${key}`);
      const type = text(field["type"]);
      if (type !== "string" && type !== "number" && type !== "boolean" && type !== "directory" && type !== "file") {
        throw new Error(`The extension's ${key} asks for a "${type || "missing"}" value, which ADCode cannot collect.`);
      }
      if (field["multiple"] === true) throw new Error(`The extension's ${key} asks for a list of values, which ADCode cannot collect yet.`);
      const preset = field["default"] === undefined || field["default"] === null ? null : String(field["default"]).slice(0, 4_096);
      userConfig.push({
        key,
        type,
        title: boundedText(field["title"], 120) || key,
        description: boundedText(field["description"], 500),
        required: field["required"] === true,
        sensitive: field["sensitive"] === true,
        preset,
      });
    }
  }

  const tools: string[] = [];
  if (Array.isArray(root["tools"])) {
    for (const tool of root["tools"].slice(0, 200)) {
      const item = record(tool);
      const toolName = item ? boundedText(item["name"], 64) : "";
      if (toolName !== "") tools.push(toolName);
    }
  }

  return {
    manifestVersion,
    name,
    displayName: boundedText(root["display_name"], 100) || name,
    version,
    description: boundedText(root["description"], 500),
    homepage: boundedText(root["homepage"], 2048) || null,
    serverType,
    entryPoint,
    command,
    args,
    env,
    userConfig,
    toolNames: tools,
  };
}

/**
 * `${__dirname}` and `${user_config.KEY}`, the two substitutions the spec defines.
 *
 * an unknown `${user_config.KEY}` is left as it stands: a visible placeholder beats a
 * silently empty argument, which is how an extension starts and then misbehaves.
 */
export function resolveManifestText(value: string, context: { readonly dirname: string; readonly userConfig: Readonly<Record<string, string>> }): string {
  return value
    .replaceAll("${__dirname}", context.dirname)
    .replace(/\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, key: string) => context.userConfig[key] ?? whole);
}

/** The draft the Add dialog shows for an extension, before its files are unpacked. */
export function mcpbDraft(manifest: McpbManifest, source: string): ConnectorDraft {
  const warnings: string[] = [];
  if (manifest.serverType === "node") warnings.push("Starts with Node.js, which must be on this computer.");
  if (manifest.serverType === "python") warnings.push("Starts with Python, which must be on this computer.");
  const values: DraftValue[] = manifest.userConfig.map(field => ({
    key: field.key,
    label: field.title,
    hint: field.description || (field.type === "directory" || field.type === "file" ? "A full path on this computer." : null),
    required: field.required || field.sensitive,
    secret: field.sensitive,
    preset: field.sensitive ? null : field.preset,
  }));
  const count = manifest.toolNames.length;
  return {
    kind: "extension",
    name: manifest.displayName,
    slug: slugify(manifest.name, "extension"),
    purpose: manifest.description || `A one-click extension${count > 0 ? ` with ${count.toString()} tool${count === 1 ? "" : "s"}` : ""}, packaged for Claude Desktop and read by ADCode.`,
    source,
    origin: "extension",
    transport: "stdio",
    endpoint: manifest.command,
    args: manifest.args,
    env: manifest.env,
    headers: {},
    values,
    spec: null,
    auth: null,
    skills: [],
    servers: [],
    warnings,
    homepage: manifest.homepage,
  };
}
