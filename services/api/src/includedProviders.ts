/** Approved server connections. Destinations and secret names cannot be supplied by clients. */
export const INCLUDED_PROVIDERS = [
  { id: "tagflow", name: "Tagflow AI", baseUrl: "", secretName: "TAGFLOW_API_KEY", docs: "https://tagflow-ai.com/" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", secretName: "INCLUDED_AI_OPENAI_API_KEY", docs: "https://developers.openai.com/api/reference/resources/chat" },
  { id: "google", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", secretName: "INCLUDED_AI_GOOGLE_API_KEY", docs: "https://ai.google.dev/gemini-api/docs/openai" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", secretName: "INCLUDED_AI_GROQ_API_KEY", docs: "https://console.groq.com/docs/openai" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", secretName: "INCLUDED_AI_OPENROUTER_API_KEY", docs: "https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion" },
] as const;

export type IncludedProviderId = typeof INCLUDED_PROVIDERS[number]["id"];
export const includedProvider = (id: IncludedProviderId) => INCLUDED_PROVIDERS.find((provider) => provider.id === id)!;
export const modelProvider = (model: { provider?: IncludedProviderId }): IncludedProviderId => model.provider ?? "tagflow";
