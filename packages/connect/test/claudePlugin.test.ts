import { describe, expect, it } from "vitest";
import { nestedServers, parseMarketplace, parsePluginManifest, pluginDraft, resolvePluginText } from "../src/claudePlugin.ts";
import { parseMcpServersDocument } from "../src/mcpConfig.ts";

describe("parsePluginManifest", () => {
  it("reads .claude-plugin/plugin.json", () => {
    const manifest = parsePluginManifest(JSON.stringify({
      name: "commit-helper",
      description: "Writes commit messages the way this team likes them.",
      version: "2.0.1",
      author: { name: "Ada", email: "ada@example.com" },
      homepage: "https://example.com/commit-helper",
      license: "MIT",
    }), "commit-helper");
    expect(manifest).toMatchObject({ name: "commit-helper", version: "2.0.1", author: "Ada", license: "MIT" });
  });
  it("falls back to the folder name and refuses names it cannot keep", () => {
    expect(parsePluginManifest("{}", "my-plugin").name).toBe("my-plugin");
    expect(() => parsePluginManifest('{"name":"Not A Slug"}', "x")).toThrow(/lowercase letters/);
    expect(() => parsePluginManifest("nope", "x")).toThrow(/plugin.json is not valid JSON/);
  });
});

describe("parseMarketplace", () => {
  it("lists local plugins and notes the remote ones", () => {
    const marketplace = parseMarketplace(JSON.stringify({
      name: "team-tools",
      metadata: { description: "Everything the team ships." },
      plugins: [
        { name: "commit-helper", source: "./plugins/commit-helper", description: "Commit messages." },
        { name: "remote-one", source: { source: "github", repo: "acme/tools" } },
        { name: "unsafe", source: "./../elsewhere" },
      ],
    }));
    expect(marketplace.name).toBe("team-tools");
    expect(marketplace.description).toBe("Everything the team ships.");
    expect(marketplace.plugins).toEqual([
      { name: "commit-helper", description: "Commit messages.", localPath: "plugins/commit-helper" },
      { name: "remote-one", description: "", localPath: null },
      { name: "unsafe", description: "", localPath: null },
    ]);
  });
});

describe("pluginDraft", () => {
  const contents = {
    manifest: { name: "team-kit", displayName: "Team Kit", version: "1.0.0", description: "", homepage: null, license: null, author: null },
    skills: ["review-code", "write-tests"],
    commands: ["deploy"],
    agents: ["tester"],
    hooks: true,
    servers: [],
    source: "Claude Code plugin: Team Kit",
  };
  it("explains what will be honoured and what will not", () => {
    const draft = pluginDraft(contents, "https://example.com/team-kit");
    expect(draft).toMatchObject({ kind: "plugin", name: "Team Kit", slug: "team-kit", skills: ["review-code", "write-tests"] });
    expect(draft.purpose).toContain("2 skills");
    expect(draft.warnings.join(" ")).toMatch(/1 command will be copied but not offered/);
    expect(draft.warnings.join(" ")).toMatch(/1 agent will be copied but not run/);
    expect(draft.warnings.join(" ")).toMatch(/hooks/);
  });

  it("carries the plugin's own servers as nested drafts", () => {
    const { drafts } = parseMcpServersDocument(JSON.stringify({
      mcpServers: { notes: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"], env: { NOTES_KEY: "x" } } },
    }), { source: "Plugin" });
    const nested = nestedServers(drafts);
    expect(nested[0]).toMatchObject({ name: "notes", slug: "notes", endpoint: "node" });
    const withServers = pluginDraft({ ...contents, servers: nested }, null);
    expect(withServers.servers).toHaveLength(1);
    expect(withServers.purpose).toContain("1 MCP server");
  });
});

describe("resolvePluginText", () => {
  it("replaces both spellings of the plugin root", () => {
    expect(resolvePluginText("${CLAUDE_PLUGIN_ROOT}/a ${pluginRoot}/b", "/plugins/team-kit")).toBe("/plugins/team-kit/a /plugins/team-kit/b");
  });
});
