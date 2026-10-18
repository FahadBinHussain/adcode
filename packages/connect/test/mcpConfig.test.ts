import { describe, expect, it } from "vitest";
import { parseMcpServersDocument } from "../src/mcpConfig.ts";

const claude = { source: "Claude Desktop", purpose: "An MCP server from Claude Desktop." };

describe("parseMcpServersDocument", () => {
  it("reads a Claude Desktop config: command, args, env and a description", () => {
    const { drafts, warnings } = parseMcpServersDocument(JSON.stringify({
      mcpServers: {
        "github-tools": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret", LOG_LEVEL: "warn" },
          description: "Read issues and pull requests.",
        },
      },
    }), claude);
    expect(warnings.filter(entry => !entry.includes("github-tools"))).toEqual([]);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft).toMatchObject({
      kind: "mcp",
      name: "github-tools",
      slug: "github-tools",
      transport: "stdio",
      endpoint: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      purpose: "Read issues and pull requests.",
      source: "Claude Desktop",
      origin: "import",
    });
    expect(draft.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret", LOG_LEVEL: "warn" });
    expect(draft.warnings.some(warning => warning.includes("credential"))).toBe(true);
  });

  it("reads the VS Code shape: servers, declared types and headers", () => {
    const { drafts } = parseMcpServersDocument(JSON.stringify({
      servers: {
        "docs-server": { type: "http", url: "https://docs.example.com/mcp", headers: { "X-Api-Key": "k" } },
        "legacy": { type: "sse", url: "https://legacy.example.com/sse" },
      },
    }), { source: "VS Code" });
    expect(drafts.map(draft => [draft.name, draft.transport])).toEqual([["docs-server", "http"], ["legacy", "sse"]]);
    expect(drafts[0]?.headers).toEqual({ "X-Api-Key": "k" });
    expect(drafts[0]?.purpose).toBe("An MCP server imported from VS Code.");
  });

  it("accepts a single pasted server entry under the fallback name", () => {
    const { drafts } = parseMcpServersDocument('{"command":"uvx","args":["mcp-server-fetch"]}', { source: "Pasted", fallbackName: "fetch" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ name: "fetch", endpoint: "uvx" });
  });

  it("skips unusable entries with a reason and keeps the rest", () => {
    const { drafts, warnings } = parseMcpServersDocument(JSON.stringify({
      mcpServers: {
        good: { command: "node", args: ["server.js"] },
        empty: {},
        "bad-type": { type: "websocket", url: "https://x.example.com" },
        "not-secure": { url: "http://public.example.com/mcp" },
      },
    }), claude);
    expect(drafts.map(draft => draft.name)).toEqual(["good"]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/neither a command nor a URL/);
    expect(warnings[1]).toMatch(/websocket|x.example.com/);
    expect(warnings[2]).toMatch(/not an HTTPS address/);
  });

  it("strips credentials, query and fragment from a URL and says so", () => {
    const { drafts } = parseMcpServersDocument(JSON.stringify({
      mcpServers: { remote: { url: "https://user:pass@api.example.com/mcp?key=1#frag" } },
    }), claude);
    expect(drafts[0]?.endpoint).toBe("https://api.example.com/mcp");
    expect(drafts[0]?.warnings.some(warning => warning.includes("credentials"))).toBe(true);
  });

  it("drops environment names it cannot pass to a child process", () => {
    const { drafts } = parseMcpServersDocument(JSON.stringify({
      mcpServers: { quirky: { command: "node", env: { "not a name": "x", GOOD_ONE: "y", "OBJ": { nested: true } } } },
    }), claude);
    expect(drafts[0]?.env).toEqual({ GOOD_ONE: "y" });
    expect(drafts[0]?.warnings.filter(warning => warning.includes("dropped")).length).toBe(2);
  });

  it("refuses documents with no servers at all", () => {
    expect(() => parseMcpServersDocument('{"mcpServers":{}}', claude)).not.toThrow();
    expect(() => parseMcpServersDocument('{"something":"else"}', claude)).toThrow(/No servers found/);
    expect(() => parseMcpServersDocument("not json", claude)).toThrow(/not valid JSON/);
  });
});
