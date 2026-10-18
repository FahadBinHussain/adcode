/**
 * The front door: whatever document arrived, work out what it is.
 *
 * One function of sniffing, because the file name is a hint and the content is the truth -
 * people rename downloads, and paste text with no name at all. Three formats still need
 * their surroundings (a plugin needs its folder, a plugin manifest needs a fetch), so
 * detection is separate from conversion; the caller with file system and network access
 * finishes those.
 */
import { aiPluginDraft, parseAiPlugin, actionsDraft } from "./openaiPlugin.ts";
import { mcpbDraft, parseMcpbManifest } from "./mcpb.ts";
import { parseMcpServersDocument, type McpConfigContext } from "./mcpConfig.ts";
import { parseOpenApi } from "./openapi.ts";
import type { ConnectorDraft } from "./types.ts";

export type DocumentFormat = "mcp-config" | "mcpb-manifest" | "ai-plugin" | "openapi" | "claude-plugin" | "marketplace" | "unknown";

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** What this document is, by content first and file name second. */
export function detectDocument(text: string, fileName?: string | null): DocumentFormat {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unknown";
  }
  const root = record(parsed);
  if (root === null) return "unknown";
  const lowerName = (fileName ?? "").toLowerCase();

  if (typeof root["manifest_version"] === "string" && record(root["server"]) !== null) return "mcpb-manifest";
  if (typeof root["name_for_model"] === "string" && record(root["api"]) !== null) return "ai-plugin";
  if (typeof root["openapi"] === "string" || typeof root["swagger"] === "string") return "openapi";
  if (Array.isArray(root["plugins"]) || lowerName.endsWith("marketplace.json")) return "marketplace";
  for (const key of ["mcpServers", "servers", "mcp_servers"] as const) if (record(root[key]) !== null) return "mcp-config";
  if (typeof root["command"] === "string" || typeof root["url"] === "string") return "mcp-config";
  if (lowerName.endsWith(".mcpb") || lowerName.endsWith(".dxt")) return "unknown";
  if (lowerName.endsWith("plugin.json") || (typeof root["name"] === "string" && ["commands", "agents", "skills", "hooks", "mcpServers"].some(key => root[key] !== undefined))) return "claude-plugin";
  return "unknown";
}

export interface DocumentContext extends McpConfigContext {
  /** Where the text was read from, for resolving relative URLs. */
  readonly sourceUrl?: string | null;
  /** The file's name, when there is one - the second half of detection. */
  readonly fileName?: string | null;
}

/**
 * Every draft a self-contained document holds.
 *
 * Handles the three formats that need nothing but their own text: a server config, an
 * OpenAPI description, and a bare extension manifest (which is offered with the warning
 * that it needs its files). The other formats are refused with the reason, so a caller
 * that skipped detection still cannot silently produce nothing.
 */
export function draftsFromDocument(text: string, context: DocumentContext): readonly ConnectorDraft[] {
  const format = detectDocument(text, context.fileName);
  switch (format) {
    case "mcp-config": {
      return parseMcpServersDocument(text, context).drafts;
    }
    case "openapi": {
      const doc = parseOpenApi(text, context.sourceUrl ? { documentUrl: context.sourceUrl } : {});
      return [actionsDraft(text, doc, context.source, context.fallbackName ?? null)];
    }
    case "mcpb-manifest": {
      const draft = mcpbDraft(parseMcpbManifest(text), context.source);
      return [{ ...draft, warnings: [...draft.warnings, "This is only the extension's manifest; choose the .mcpb file itself so its files come with it."] }];
    }
    case "ai-plugin":
      throw new Error("This is a ChatGPT plugin manifest. Its API description lives at the URL in api.url, which ADCode fetches when you choose the file or paste its URL.");
    case "claude-plugin":
      throw new Error("This is a Claude Code plugin manifest. Choose the plugin's folder or zip so its skills and servers come with it.");
    case "marketplace":
      throw new Error("This is a Claude Code marketplace. Choose the marketplace folder so its plugins can be listed.");
    default:
      throw new Error(context.fileName ? `ADCode does not recognise ${context.fileName}. It reads MCP server configs, OpenAPI descriptions, ChatGPT plugin manifests, Claude plugins and .mcpb extensions.` : "ADCode does not recognise this document. It reads MCP server configs, OpenAPI descriptions, ChatGPT plugin manifests, Claude plugins and .mcpb extensions.");
  }
}

/** The pieces a ChatGPT plugin needs beyond its manifest: its spec, once fetched. */
export function draftsFromAiPlugin(manifestText: string, specText: string, sourceUrl: string | null, source: string): readonly ConnectorDraft[] {
  const manifest = parseAiPlugin(manifestText, sourceUrl);
  const doc = parseOpenApi(specText, sourceUrl !== null ? { documentUrl: sourceUrl } : {});
  return [aiPluginDraft(manifest, specText, doc, source)];
}
