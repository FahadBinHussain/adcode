/** Built-in server connections. Clients can never supply a destination or a secret name. */
export const INCLUDED_PROVIDERS = [
  { id: "tagflow", name: "Tagflow AI", baseUrl: "", secretName: "TAGFLOW_API_KEY", docs: "https://tagflow-ai.com/" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", secretName: "INCLUDED_AI_OPENAI_API_KEY", docs: "https://developers.openai.com/api/reference/resources/chat" },
  { id: "google", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", secretName: "INCLUDED_AI_GOOGLE_API_KEY", docs: "https://ai.google.dev/gemini-api/docs/openai" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", secretName: "INCLUDED_AI_GROQ_API_KEY", docs: "https://console.groq.com/docs/openai" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", secretName: "INCLUDED_AI_OPENROUTER_API_KEY", docs: "https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion" },
] as const;

export type BuiltinProviderId = typeof INCLUDED_PROVIDERS[number]["id"];
export type CustomProviderId = `custom-${string}`;
export type IncludedProviderId = BuiltinProviderId | CustomProviderId;

export const PROVIDER_AUTHENTICATION = ["bearer", "x-api-key", "api-key"] as const;
export const OUTPUT_TOKEN_FIELDS = ["max_tokens", "max_completion_tokens"] as const;
export type ProviderAuthentication = typeof PROVIDER_AUTHENTICATION[number];
export type OutputTokenField = typeof OUTPUT_TOKEN_FIELDS[number];

/** One daily allowance per account. Request values at their reserved maximum mean unlimited. */
export interface TagflowLimits {
  dailyRequests: number;
  dailyTokens: number;
  dailyCostMicros: number;
  requestsPerMinute: number;
}

/** An OpenAI-compatible provider an administrator registered. Its key is a server secret, never stored here. */
export interface CustomProvider {
  id: CustomProviderId;
  name: string;
  baseUrl: string;
  /** Missing means `Authorization: Bearer`. */
  authentication?: ProviderAuthentication;
  /** Missing means `max_tokens`. */
  outputTokenField?: OutputTokenField;
  /** This provider's models get their own daily allowance per account; missing shares the main one. */
  limits?: TagflowLimits;
}

export interface ProviderConnection {
  id: IncludedProviderId;
  name: string;
  baseUrl: string;
  secretName: string;
  docs?: string;
  authentication: ProviderAuthentication;
  outputTokenField: OutputTokenField;
  custom: boolean;
  limits?: TagflowLimits;
}

/**
 * The account key a request is charged to. A provider with its own allowance keeps a separate
 * per-account pool under `<uid>#<provider>`, in the same atomic tables as the main allowance.
 * Firebase account IDs never contain `#`, so a pool can never collide with an account.
 */
export const allowanceKey = (uid: string, connection: Pick<ProviderConnection, "id" | "limits"> | undefined): string =>
  connection?.limits === undefined ? uid : `${uid}#${connection.id}`;
export const allowanceAccount = (key: string): { uid: string; pool: string | null } => {
  const at = key.indexOf("#");
  return at < 0 ? { uid: key, pool: null } : { uid: key.slice(0, at), pool: key.slice(at + 1) };
};

export const CUSTOM_PROVIDER_ID = /^custom-[a-z][a-z0-9-]{0,39}$/;
export const MAX_CUSTOM_PROVIDERS = 20;
export const isCustomProviderId = (id: unknown): id is CustomProviderId => typeof id === "string" && CUSTOM_PROVIDER_ID.test(id);

/**
 * Always inside the INCLUDED_AI_CUSTOM_ namespace, so a registered provider can only read its own
 * key and never another server secret. Hyphens are the only separator an ID allows, so the
 * mapping is one-to-one.
 */
export const customProviderSecretName = (id: CustomProviderId): string => `INCLUDED_AI_${id.toUpperCase().replaceAll("-", "_")}_API_KEY`;

/** A stable ID for a new provider, derived from its name and unique among `taken`. */
export function customProviderId(name: string, taken: readonly string[]): CustomProviderId {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(slug)) slug = `p-${slug}`.replace(/-+$/, "");
  slug = slug.slice(0, 36).replace(/-+$/, "");
  let id = `custom-${slug}` as CustomProviderId;
  for (let n = 2; taken.includes(id); n++) id = `custom-${slug}-${n}` as CustomProviderId;
  return id;
}

/**
 * Public HTTPS API bases only: no port, credentials, query or fragment, and no IP literal or
 * local name, so a registered address cannot reach the server's own network.
 */
export function isCustomProviderUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return baseUrl.length <= 500 && url.protocol === "https:" && url.port === "" &&
      !url.username && !url.password && !url.search && !url.hash && !baseUrl.includes("#") && !baseUrl.includes("?") &&
      host.includes(".") && !host.startsWith("[") && !/^[\d.]+$/.test(host) &&
      !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa|test|invalid|example)$/.test(host);
  } catch { return false; }
}

export function providerConnections(custom: readonly CustomProvider[] = []): ProviderConnection[] {
  return [
    ...INCLUDED_PROVIDERS.map((provider): ProviderConnection => ({ ...provider, authentication: "bearer", outputTokenField: provider.id === "openai" ? "max_completion_tokens" : "max_tokens", custom: false })),
    ...custom.map((provider): ProviderConnection => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, secretName: customProviderSecretName(provider.id), authentication: provider.authentication ?? "bearer", outputTokenField: provider.outputTokenField ?? "max_tokens", custom: true, ...(provider.limits === undefined ? {} : { limits: provider.limits }) })),
  ];
}

export const includedProvider = (id: IncludedProviderId, custom: readonly CustomProvider[] = []): ProviderConnection | undefined =>
  providerConnections(custom).find((provider) => provider.id === id);
export const modelProvider = (model: { provider?: IncludedProviderId }): IncludedProviderId => model.provider ?? "tagflow";
