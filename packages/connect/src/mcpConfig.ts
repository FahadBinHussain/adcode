/**
 * The `mcpServers` / `servers` JSON family - the file every other AI tool writes.
 *
 * Claude Desktop (`claude_desktop_config.json`), Claude Code (`.mcp.json`, and the
 * `mcpServers` key of `~/.claude.json`), Cursor (`mcp.json`), Windsurf
 * (`mcp_config.json`) and VS Code (`.vscode/mcp.json`) all store the same three ideas -
 * a command to run, a URL to call, or both wrong - under two different top-level keys.
 * This reads all of them, and a single bare server entry too, because that is what a
 * person pastes when they found one server they want.
 */
import { isEnvName, looksSecret, slugify, type ConnectorDraft } from "./types.ts";

export interface McpConfigParse {
  readonly drafts: readonly ConnectorDraft[];
  readonly warnings: readonly string[];
}

export interface McpConfigContext {
  /** The app or file the text came from, e.g. "Claude Desktop". */
  readonly source: string;
  /** The name to give a bare server entry with none of its own. */
  readonly fallbackName?: string;
  /** The one-line purpose put on every draft, e.g. "An MCP server already set up in Claude Desktop." */
  readonly purpose?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** RFC 7230 token: what an HTTP header name may be. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

/** String values only; numbers and booleans are accepted because configs write them. */
function stringMap(value: unknown, label: string, kind: "env" | "header", warnings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const record = asRecord(value);
  if (record === null) return map;
  for (const [key, raw] of Object.entries(record)) {
    const text = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : null;
    if (kind === "env" ? !isEnvName(key) : !HEADER_NAME.test(key)) {
      warnings.push(kind === "env" ? `${label}: dropped ${key} - a name must use letters, digits and underscores.` : `${label}: dropped ${key} - it is not an HTTP header name.`);
      continue;
    }
    if (text === null) {
      warnings.push(`${label}: dropped ${key} - its value is not text.`);
      continue;
    }
    if (text.length > 4_096 || text.includes("\0")) {
      warnings.push(`${label}: dropped ${key} - its value is too long or not plain text.`);
      continue;
    }
    map[key] = text;
  }
  return map;
}

function stringList(value: unknown, label: string, warnings: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${label}: dropped its arguments - they are not a list.`);
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.includes("\0")) {
      warnings.push(`${label}: dropped an argument that is not text.`);
      continue;
    }
    if (item.length > 2_048) {
      warnings.push(`${label}: dropped an argument longer than 2,048 characters.`);
      continue;
    }
    out.push(item);
  }
  return out.slice(0, 40);
}

type TransportChoice = { readonly transport: "stdio" | "http" | "sse" } | { readonly problem: string };

function transportOf(value: Record<string, unknown>): TransportChoice {
  const declared = typeof value["type"] === "string" ? value["type"].toLowerCase() : typeof value["transport"] === "string" ? value["transport"].toLowerCase() : null;
  if (declared !== null) {
    if (declared === "stdio") return { transport: "stdio" };
    if (declared === "http" || declared === "streamable-http" || declared === "streamablehttp") return { transport: "http" };
    if (declared === "sse") return { transport: "sse" };
    return { problem: `declares what it speaks as "${declared}", which ADCode does not speak` };
  }
  if (typeof value["url"] === "string") return { transport: "http" };
  if (typeof value["command"] === "string") return { transport: "stdio" };
  return { problem: "has neither a command nor a URL" };
}

/** One entry, or null with the reason it cannot become one. */
export function parseServerEntry(name: string, value: unknown, context: McpConfigContext): { readonly draft: ConnectorDraft | null; readonly warnings: readonly string[] } {
  const warnings: string[] = [];
  const record = asRecord(value);
  if (record === null) return { draft: null, warnings: [`"${name}" is not a server entry, so it was skipped.`] };
  const choice = transportOf(record);
  if ("problem" in choice) {
    return { draft: null, warnings: [`"${name}" ${choice.problem}, so it was skipped.`] };
  }
  const transport = choice.transport;
  if (record["disabled"] === true) warnings.push(`"${name}" is turned off in ${context.source}; it was added as off too.`);

  let endpoint: string;
  if (transport === "stdio") {
    endpoint = String(record["command"] ?? "").trim();
    if (endpoint === "" || endpoint.includes("\0") || endpoint.length > 2_048) {
      return { draft: null, warnings: [`"${name}" has an empty or unusable command, so it was skipped.`] };
    }
  } else {
    endpoint = String(record["url"] ?? "").trim();
    if (endpoint === "" || endpoint.includes("\0") || endpoint.length > 2_048) {
      return { draft: null, warnings: [`"${name}" has an empty or unusable URL, so it was skipped.`] };
    }
    let url: URL | null = null;
    try { url = new URL(endpoint); } catch { url = null; }
    if (url === null || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
      return { draft: null, warnings: [`"${name}" points at ${endpoint}, which is not an HTTPS address, so it was skipped.`] };
    }
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      warnings.push(`"${name}": the URL's credentials, query or fragment were removed; use its sign-in step instead.`);
      endpoint = `${url.origin}${url.pathname}`;
    }
  }

  const env = transport === "stdio" ? stringMap(record["env"], name, "env", warnings) : {};
  const headers = transport !== "stdio" ? stringMap(record["headers"], name, "header", warnings) : {};
  const values = [...Object.keys(env), ...Object.keys(headers)];
  if (values.length > 0) {
    const secrets = values.filter(looksSecret).length;
    warnings.push(`"${name}" carries ${values.length === 1 ? "one value" : `${values.length.toString()} values`}${secrets > 0 ? `, ${secrets === 1 ? "one of them a credential" : `${secrets.toString()} of them credentials`} that go to the encrypted store` : ""}.`);
  }

  const description = typeof record["description"] === "string" ? record["description"].trim().slice(0, 300) : "";
  return {
    draft: {
      kind: "mcp",
      name,
      slug: slugify(name, "imported-server"),
      purpose: description !== "" ? description : context.purpose ?? `An MCP server imported from ${context.source}.`,
      source: context.source,
      origin: "import",
      transport,
      endpoint,
      args: transport === "stdio" ? stringList(record["args"], name, warnings) : [],
      env,
      headers,
      values: [],
      spec: null,
      auth: null,
      skills: [],
      servers: [],
      warnings,
      homepage: null,
    },
    warnings,
  };
}

const SERVER_KEYS = ["mcpServers", "servers", "mcp_servers"] as const;

/**
 * Every server in a config document, as drafts.
 *
 * Accepts the three top-level spellings in use, and - for a person pasting one server
 * out of a file - a bare entry with `command` or `url` at the root.
 */
export function parseMcpServersDocument(text: string, context: McpConfigContext): McpConfigParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${context.source} is not valid JSON.`);
  }
  const root = asRecord(parsed);
  if (root === null) throw new Error(`${context.source} is not a server configuration.`);

  let entries: Record<string, unknown> | null = null;
  for (const key of SERVER_KEYS) {
    const candidate = asRecord(root[key]);
    if (candidate !== null) { entries = candidate; break; }
  }
  const drafts: ConnectorDraft[] = [];
  const warnings: string[] = [];
  if (entries === null) {
    const single = parseServerEntry(context.fallbackName ?? "imported-server", root, context);
    if (single.draft !== null) drafts.push(single.draft);
    warnings.push(...single.warnings);
    if (single.draft === null) throw new Error(`No servers found in ${context.source}. Expected an "mcpServers" or "servers" object.`);
    return { drafts, warnings };
  }
  for (const [name, value] of Object.entries(entries)) {
    if (name.length === 0 || name.length > 100) { warnings.push("Skipped a server whose name is empty or too long."); continue; }
    const entry = parseServerEntry(name, value, context);
    if (entry.draft !== null) drafts.push(entry.draft);
    else warnings.push(...entry.warnings);
  }
  return { drafts, warnings };
}
