import { describe, expect, it } from "vitest";
import { mcpbDraft, parseMcpbManifest, resolveManifestText } from "../src/mcpb.ts";

const manifest = {
  manifest_version: "0.3",
  name: "readwise-notes",
  display_name: "Readwise Notes",
  version: "1.2.0",
  description: "Search your highlights and notes from the conversation.",
  homepage: "https://example.com/readwise",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js", "--port", "${user_config.PORT}"],
      env: { READWISE_TOKEN: "${user_config.TOKEN}", PORT: "${user_config.PORT}" },
    },
  },
  user_config: {
    TOKEN: { type: "string", title: "Readwise token", description: "From readwise.io/access_token", required: true, sensitive: true },
    PORT: { type: "number", title: "Port", default: 8421 },
  },
  tools: [{ name: "search_notes", description: "Search" }],
};

describe("parseMcpbManifest", () => {
  it("reads a valid manifest into a value", () => {
    const parsed = parseMcpbManifest(JSON.stringify(manifest));
    expect(parsed).toMatchObject({ name: "readwise-notes", displayName: "Readwise Notes", serverType: "node", command: "node", entryPoint: "server/index.js" });
    expect(parsed.userConfig).toEqual([
      { key: "TOKEN", type: "string", title: "Readwise token", description: "From readwise.io/access_token", required: true, sensitive: true, preset: null },
      { key: "PORT", type: "number", title: "Port", description: "", required: false, sensitive: false, preset: "8421" },
    ]);
    expect(parsed.toolNames).toEqual(["search_notes"]);
  });

  it("refuses manifests it cannot honour, with a sentence each", () => {
    expect(() => parseMcpbManifest("not json")).toThrow(/not valid JSON/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, manifest_version: "9.9" }))).toThrow(/manifest version 9.9/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, name: "Not Lowercase" }))).toThrow(/lowercase name/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, server: { ...manifest.server, type: "ruby" } }))).toThrow(/ruby/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, server: { ...manifest.server, entry_point: "../outside.js" } }))).toThrow(/relative file/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, server: { type: "node", entry_point: "x.js" } }))).toThrow(/no mcp_config/);
    expect(() => parseMcpbManifest(JSON.stringify({ ...manifest, user_config: { LIST: { type: "string", multiple: true } } }))).toThrow(/list of values/);
  });
});

describe("mcpbDraft", () => {
  it("asks for the sensitive and required settings, and never presets a secret", () => {
    const draft = mcpbDraft(parseMcpbManifest(JSON.stringify(manifest)), "readwise-notes.mcpb");
    expect(draft).toMatchObject({ kind: "extension", name: "Readwise Notes", slug: "readwise-notes", transport: "stdio", endpoint: "node", origin: "extension" });
    expect(draft.values).toEqual([
      { key: "TOKEN", label: "Readwise token", hint: "From readwise.io/access_token", required: true, secret: true, preset: null },
      { key: "PORT", label: "Port", hint: null, required: false, secret: false, preset: "8421" },
    ]);
    expect(draft.warnings.some(warning => warning.includes("Node.js"))).toBe(true);
  });
});

describe("resolveManifestText", () => {
  it("replaces __dirname and user_config answers", () => {
    const resolved = resolveManifestText("${__dirname}/server/index.js --token ${user_config.TOKEN}", { dirname: "C:/Users/x/.adcode/extensions/readwise", userConfig: { TOKEN: "abc" } });
    expect(resolved).toBe("C:/Users/x/.adcode/extensions/readwise/server/index.js --token abc");
  });
  it("leaves an unanswered key visible rather than empty", () => {
    expect(resolveManifestText("${user_config.MISSING}", { dirname: "/x", userConfig: {} })).toBe("${user_config.MISSING}");
  });
});
