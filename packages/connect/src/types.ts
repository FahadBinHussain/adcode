/**
 * The one shape every outside format is reduced to.
 *
 * Claude calls them connectors, extensions and plugins; OpenAI calls them connectors,
 * apps and actions. They arrive as five different JSON documents and one zip. Everything
 * in this package reads one of those and answers with a `ConnectorDraft` - one thing the
 * person can look at and choose to add - so the desktop app has exactly one import path
 * to get right.
 *
 * Pure: no fs, no network, no Electron. The zip bytes and config text arrive as arguments.
 */

/** What a draft becomes in the app: an MCP connector, or a connector built from an API description. */
export type DraftKind = "mcp" | "openapi" | "extension" | "plugin";

export type DraftTransport = "stdio" | "http" | "sse";

/** Where the draft came from, so the card can say it and the docs can be honest about it. */
export type DraftOrigin = "import" | "extension" | "plugin" | "actions";

/** A question the person must answer before the draft can work, e.g. an API key it needs. */
export interface DraftValue {
  /** Environment variable or manifest key the answer fills. */
  readonly key: string;
  readonly label: string;
  readonly hint: string | null;
  readonly required: boolean;
  /** The answer is a credential: it goes to the OS-encrypted store, never to settings JSON. */
  readonly secret: boolean;
  /** A value the source already carries. Non-secret values may be shown as the default. */
  readonly preset: string | null;
}

/**
 * The reserved value key for an OpenAPI draft's base address.
 *
 * A description that names no server address (or names a relative one) still describes
 * callable operations; the Add dialog asks for the address under this key, and the
 * service stores the answer as the connector's endpoint rather than an environment value.
 */
export const BASE_URL_KEY = "__base_url";

/** One MCP server a plugin ships beside its skills. */
export interface NestedServerDraft {
  readonly name: string;
  readonly slug: string;
  /** `${PLUGIN_ROOT}` in any of these is replaced with the plugin's install folder. */
  readonly transport: DraftTransport;
  readonly endpoint: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export interface ConnectorDraft {
  readonly kind: DraftKind;
  readonly name: string;
  readonly slug: string;
  /** One plain sentence: what this lets the assistant do. */
  readonly purpose: string;
  /** The app or file it was read from, e.g. "Claude Desktop" or "claude_desktop_config.json". */
  readonly source: string;
  readonly origin: DraftOrigin;
  readonly transport: DraftTransport;
  /**
   * What to run or call: a command for stdio, a URL for http/sse, and the base URL for
   * an OpenAPI draft. For plugin and extension drafts, the command they will run once
   * their files are installed (still carrying their `${...}` placeholders).
   */
  readonly endpoint: string;
  readonly args: readonly string[];
  /** Literal values found in the source. The service moves them to the encrypted store. */
  readonly env: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  /** Questions to ask before adding. */
  readonly values: readonly DraftValue[];
  /** OpenAPI drafts only: the spec text and how to authenticate. */
  readonly spec: string | null;
  readonly auth: DraftAuth | null;
  /** Plugin drafts only: the skills the plugin folder holds. */
  readonly skills: readonly string[];
  /** Plugin drafts only: servers the plugin's own .mcp.json declares. */
  readonly servers: readonly NestedServerDraft[];
  /** Things that will not work as-is, in plain words. Never blocks the draft; the app shows them. */
  readonly warnings: readonly string[];
  readonly homepage: string | null;
}

/** OpenAI action auth, reduced to what ADCode can actually send. */
export interface DraftAuth {
  readonly kind: "none" | "bearer" | "header" | "query";
  /** The header or query name for kind "header" or "query". */
  readonly name: string | null;
  /** True when the source says the person must supply the credential. */
  readonly needsToken: boolean;
}

/** A lowercase, hyphenated identifier, the only kind the app's saved connectors accept. */
export function slugify(name: string, fallback = "connector"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const trimmed = slug.replace(/-+$/g, "");
  return /^[a-z0-9]/.test(trimmed) ? trimmed : `${fallback}`;
}

/** Env variable and manifest key names: letters, digits, underscore, not starting with a digit. */
export const isEnvName = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);

/**
 * Whether a name reads like a credential.
 *
 * Used only to decide how loudly the UI warns; every env value the app stores goes to
 * the encrypted store regardless, so a false negative here is a missing hint, not a leak.
 */
export const looksSecret = (name: string): boolean =>
  /(api[_-]?key|token|secret|password|passwd|credential|auth|bearer|private[_-]?key)/i.test(name);
