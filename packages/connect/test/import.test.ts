import { describe, expect, it } from "vitest";
import { detectDocument, draftsFromAiPlugin, draftsFromDocument } from "../src/import.ts";
import { actionsDraft, parseAiPlugin } from "../src/openaiPlugin.ts";
import { parseOpenApi } from "../src/openapi.ts";
import { BASE_URL_KEY } from "../src/types.ts";

const manifest = {
  schema_version: "v1",
  name_for_model: "weather_bot",
  name_for_human: "Weather Bot",
  description_for_model: "Look up the weather for a place.",
  description_for_human: "Ask about the weather anywhere.",
  auth: { type: "service_http", authorization_type: "bearer", verification_tokens: { openai: "x" } },
  api: { type: "openapi", url: "https://weather.example.com/openapi.json" },
  legal_info_url: "https://weather.example.com/terms",
};

const spec = {
  openapi: "3.0.0",
  info: { title: "Weather", version: "2.0" },
  servers: [{ url: "https://api.weather.example.com" }],
  paths: {
    "/forecast": {
      get: {
        operationId: "get_forecast",
        summary: "Get the forecast",
        parameters: [{ name: "city", in: "query", required: true, schema: { type: "string" } }],
      },
    },
  },
};

describe("parseAiPlugin", () => {
  it("reads the manifest and reduces its auth to a bearer token", () => {
    const parsed = parseAiPlugin(JSON.stringify(manifest), null);
    expect(parsed).toMatchObject({ nameForModel: "weather_bot", nameForHuman: "Weather Bot", apiUrl: "https://weather.example.com/openapi.json" });
    expect(parsed.auth).toEqual({ kind: "bearer", name: null, needsToken: true });
  });
  it("maps none, and treats oauth as a token the person already has", () => {
    expect(parseAiPlugin(JSON.stringify({ ...manifest, auth: { type: "none" } }), null).auth.kind).toBe("none");
    expect(parseAiPlugin(JSON.stringify({ ...manifest, auth: { type: "oauth", client_url: "https://x" } }), null).auth).toEqual({ kind: "bearer", name: null, needsToken: true });
  });
  it("resolves a relative api.url against where the manifest was read", () => {
    const relative = JSON.stringify({ ...manifest, api: { type: "openapi", url: "/openapi.json" } });
    expect(parseAiPlugin(relative, "https://weather.example.com/.well-known/ai-plugin.json").apiUrl).toBe("https://weather.example.com/openapi.json");
    expect(() => parseAiPlugin(relative, null)).toThrow(/relative/);
  });
  it("refuses manifests it cannot use", () => {
    expect(() => parseAiPlugin("nope", null)).toThrow(/not valid JSON/);
    expect(() => parseAiPlugin("{}", null)).toThrow(/name_for_model/);
    expect(() => parseAiPlugin(JSON.stringify({ ...manifest, api: undefined }), null)).toThrow(/api.url/);
    expect(() => parseAiPlugin(JSON.stringify({ ...manifest, api: { type: "grpc", url: "https://x" } }), null)).toThrow(/only OpenAPI/);
  });
});

describe("draftsFromAiPlugin", () => {
  it("pairs the manifest with its spec: one openapi draft asking for the token", () => {
    const drafts = draftsFromAiPlugin(JSON.stringify(manifest), JSON.stringify(spec), null, "weather_bot.json");
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft).toMatchObject({ kind: "openapi", slug: "weather-bot", endpoint: "https://api.weather.example.com", origin: "actions" });
    expect(draft.values.map(value => value.key)).toEqual(["token"]);
    expect(draft.values[0]).toMatchObject({ secret: true, required: true });
    expect(draft.warnings.join(" ")).toContain("needs a token");
  });
  it("asks for a server address when the spec names none", () => {
    const bare = { ...spec, servers: [] };
    const draft = draftsFromAiPlugin(JSON.stringify({ ...manifest, auth: { type: "none" } }), JSON.stringify(bare), null, "x.json")[0]!;
    expect(draft.values.map(value => value.key)).toEqual([BASE_URL_KEY]);
    expect(draft.endpoint).toBe("");
  });
});

describe("actionsDraft", () => {
  it("names the connector after the API and counts its operations", () => {
    const doc = parseOpenApi(JSON.stringify(spec));
    const draft = actionsDraft(JSON.stringify(spec), doc, "openapi.json", null);
    expect(draft).toMatchObject({ kind: "openapi", name: "Weather", slug: "weather", endpoint: "https://api.weather.example.com" });
    expect(draft.purpose).toContain("1 operation");
  });
});

describe("detectDocument", () => {
  it("recognises each format by content", () => {
    expect(detectDocument('{"mcpServers":{}}')).toBe("mcp-config");
    expect(detectDocument('{"servers":{"a":{"command":"x"}}}')).toBe("mcp-config");
    expect(detectDocument('{"command":"npx"}')).toBe("mcp-config");
    expect(detectDocument(JSON.stringify(spec))).toBe("openapi");
    expect(detectDocument(JSON.stringify(manifest))).toBe("ai-plugin");
    expect(detectDocument(JSON.stringify({ manifest_version: "0.3", server: {} }))).toBe("mcpb-manifest");
    expect(detectDocument(JSON.stringify({ name: "team-kit", skills: ["./skills"] }))).toBe("claude-plugin");
    expect(detectDocument(JSON.stringify({ plugins: [{ name: "a" }] }))).toBe("marketplace");
  });
  it("uses the file name when the content alone is ambiguous", () => {
    expect(detectDocument("{}", "my-plugin/plugin.json")).toBe("claude-plugin");
    expect(detectDocument(JSON.stringify({ name: "m" }), "marketplace.json")).toBe("marketplace");
    expect(detectDocument("PK", "bundle.mcpb")).toBe("unknown");
    expect(detectDocument('{"weird": true}', "notes.json")).toBe("unknown");
  });
});

describe("draftsFromDocument", () => {
  it("converts a server config and an OpenAPI description", () => {
    const config = draftsFromDocument(JSON.stringify({ mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } } }), { source: "Pasted config" });
    expect(config[0]).toMatchObject({ kind: "mcp", name: "fetch" });
    const actions = draftsFromDocument(JSON.stringify(spec), { source: "openapi.json" });
    expect(actions[0]).toMatchObject({ kind: "openapi", endpoint: "https://api.weather.example.com" });
  });
  it("offers a bare extension manifest with a warning about its missing files", () => {
    const manifestOnly = { manifest_version: "0.3", name: "tiny", version: "1", server: { type: "node", entry_point: "index.js", mcp_config: { command: "node" } } };
    const drafts = draftsFromDocument(JSON.stringify(manifestOnly), { source: "manifest.json" });
    expect(drafts[0]?.kind).toBe("extension");
    expect(drafts[0]?.warnings.join(" ")).toContain("choose the .mcpb file");
  });
  it("refuses formats that need their surroundings, with the reason", () => {
    expect(() => draftsFromDocument(JSON.stringify(manifest), { source: "ai-plugin.json" })).toThrow(/api\.url/);
    expect(() => draftsFromDocument(JSON.stringify({ name: "x", skills: [] }), { source: "plugin.json" })).toThrow(/plugin's folder/);
    expect(() => draftsFromDocument('{"hello":1}', { source: "notes.json" })).toThrow(/does not recognise/);
  });
});
