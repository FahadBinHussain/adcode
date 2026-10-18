/**
 * Claude Code plugins: a folder of skills, commands, agents, hooks and MCP servers.
 *
 * A plugin is not one document but a small convention - `.claude-plugin/plugin.json`
 * for its name, then `skills/`, `commands/`, `agents/`, `hooks/hooks.json` and
 * `.mcp.json` beside it. This module reads the parts ADCode can honour: the skills
 * (already a first-class idea here) and the MCP servers. Commands and agents are
 * reported so the card can say what they are; hooks are reported but never run -
 * running someone's shell hooks on install is exactly the kind of surprise this app
 * does not do.
 */
import { slugify, type ConnectorDraft, type NestedServerDraft } from "./types.ts";

export interface ClaudePluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly version: string | null;
  readonly description: string;
  readonly homepage: string | null;
  readonly license: string | null;
  readonly author: string | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const bounded = (value: unknown, limit: number): string => (typeof value === "string" ? value.trim().slice(0, limit) : "");

const PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** `.claude-plugin/plugin.json`, or the folder name when a plugin has no manifest. */
export function parsePluginManifest(json: string, folderName: string): ClaudePluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("plugin.json is not valid JSON.");
  }
  const root = record(parsed);
  if (root === null) throw new Error("plugin.json must be a JSON object.");
  const name = bounded(root["name"], 64) || folderName;
  if (!PLUGIN_NAME.test(name)) throw new Error("A plugin's name must use lowercase letters, digits, hyphens or underscores.");
  const author = record(root["author"]);
  return {
    name,
    displayName: bounded(root["displayName"], 100) || bounded(root["name"], 100) || folderName,
    version: bounded(root["version"], 32) || null,
    description: bounded(root["description"], 500),
    homepage: bounded(root["homepage"], 2048) || null,
    license: bounded(root["license"], 64) || null,
    author: author ? bounded(author["name"], 100) || null : bounded(root["author"], 100) || null,
  };
}

/** One entry in a marketplace's `.claude-plugin/marketplace.json`. */
export interface MarketplacePlugin {
  readonly name: string;
  readonly description: string;
  /** A path relative to the marketplace root, or null when the plugin lives in another repository. */
  readonly localPath: string | null;
}

export interface Marketplace {
  readonly name: string;
  readonly description: string;
  readonly plugins: readonly MarketplacePlugin[];
}

/**
 * `.claude-plugin/marketplace.json`: a catalogue of plugins.
 *
 * Only plugins that live in this folder are offered for install; entries that point at
 * another repository are listed so the card can say they exist, but ADCode does not
 * clone repositories behind your back.
 */
export function parseMarketplace(json: string): Marketplace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("marketplace.json is not valid JSON.");
  }
  const root = record(parsed);
  if (root === null) throw new Error("marketplace.json must be a JSON object.");
  const plugins: MarketplacePlugin[] = [];
  if (Array.isArray(root["plugins"])) {
    for (const entry of root["plugins"].slice(0, 500)) {
      const item = record(entry);
      if (item === null) continue;
      const name = bounded(item["name"], 64);
      if (name === "") continue;
      const source = item["source"];
      let localPath: string | null = null;
      if (typeof source === "string" && source.startsWith("./") && !source.includes("..") && !source.includes("\\")) {
        localPath = source.slice(2).replace(/\/+$/, "");
      }
      plugins.push({ name, description: bounded(item["description"], 300), localPath });
    }
  }
  return { name: bounded(root["name"], 64) || "marketplace", description: bounded(record(root["metadata"])?.["description"], 300), plugins };
}

/** A plugin's own servers, ready for the draft. `${CLAUDE_PLUGIN_ROOT}` stays for install time. */
export function nestedServers(drafts: readonly ConnectorDraft[]): readonly NestedServerDraft[] {
  return drafts.map(draft => ({
    name: draft.name,
    slug: draft.slug,
    transport: draft.transport,
    endpoint: draft.endpoint,
    args: draft.args,
    env: draft.env,
    headers: draft.headers,
    warnings: draft.warnings,
  }));
}

export interface PluginContents {
  readonly manifest: ClaudePluginManifest;
  readonly skills: readonly string[];
  readonly commands: readonly string[];
  readonly agents: readonly string[];
  readonly hooks: boolean;
  readonly servers: readonly NestedServerDraft[];
  readonly source: string;
}

/** The draft the Add dialog shows for a plugin, before its folder is copied. */
export function pluginDraft(contents: PluginContents, homepage: string | null): ConnectorDraft {
  const { manifest } = contents;
  const warnings: string[] = [];
  if (contents.commands.length > 0) warnings.push(`${contents.commands.length.toString()} command${contents.commands.length === 1 ? "" : "s"} will be copied but not offered; ADCode has no slash commands yet.`);
  if (contents.agents.length > 0) warnings.push(`${contents.agents.length.toString()} agent${contents.agents.length === 1 ? "" : "s"} will be copied but not run; use ADCode's own agents instead.`);
  if (contents.hooks) warnings.push("This plugin ships hooks. ADCode copies them with the plugin but never runs them.");
  const skills = contents.skills.length;
  const servers = contents.servers.length;
  const parts = [skills > 0 ? `${skills.toString()} skill${skills === 1 ? "" : "s"}` : "", servers > 0 ? `${servers.toString()} MCP server${servers === 1 ? "" : "s"}` : ""].filter(part => part !== "");
  return {
    kind: "plugin",
    name: manifest.displayName,
    slug: slugify(manifest.name, "plugin"),
    purpose: manifest.description || `A Claude Code plugin${parts.length > 0 ? ` with ${parts.join(" and ")}` : ""}.`,
    source: contents.source,
    origin: "plugin",
    transport: "stdio",
    endpoint: manifest.name,
    args: [],
    env: {},
    headers: {},
    values: [],
    spec: null,
    auth: null,
    skills: contents.skills,
    servers: contents.servers,
    warnings,
    homepage: homepage ?? manifest.homepage,
  };
}

/** `${CLAUDE_PLUGIN_ROOT}` and its lowercase alias, replaced with the installed folder. */
export function resolvePluginText(value: string, pluginRoot: string): string {
  return value.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot).replaceAll("${pluginRoot}", pluginRoot);
}
