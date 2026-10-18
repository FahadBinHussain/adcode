import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectorSources, isArchiveBytes, type ConnectorSources } from "../src/main/connectorImport.ts";
import { makeZip } from "../../../packages/connect/test/zipFixture.ts";

/**
 * Reading what other tools already have, with the disk and network real but tiny.
 *
 * The interesting promises: nothing is installed while reading, an archive's install
 * kind follows what the archive actually holds (a plugin zip is a plugin, whatever its
 * name), and every confusing input comes back as a plain sentence in `notes` rather
 * than an exception.
 */

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp(prefix = "adcode-import-"): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: string | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const serve = (body: string | Uint8Array, contentType = "application/json"): Response =>
  new Response(body as BodyInit, { status: 200, headers: { "content-type": contentType } });

interface Harness { readonly api: ConnectorSources; readonly home: string; readonly appData: string; }
async function harness(options: { home?: string; appData?: string; workspace?: string | null } = {}): Promise<Harness> {
  const home = options.home ?? await temp("adcode-home-");
  const appData = options.appData ?? await temp("adcode-appdata-");
  return { api: createConnectorSources({ home, appData, workspace: () => options.workspace ?? null }), home, appData };
}

const mcpConfig = JSON.stringify({ mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"], env: { LOG_LEVEL: "info" } } } });
const openApiSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Issue Tracker", version: "2.0.0" },
  servers: [{ url: "https://issues.example.com/v1" }],
  paths: { "/issues": { get: { operationId: "listIssues", summary: "List issues" } } },
});
const extensionManifest = JSON.stringify({
  manifest_version: "0.3",
  name: "hello-tools",
  display_name: "Hello Tools",
  version: "1.0.0",
  description: "Says hello from a desktop extension.",
  server: { type: "node", entry_point: "server/index.js", mcp_config: { command: "node", args: ["${__dirname}/server/index.js"] } },
  user_config: { API_KEY: { type: "string", title: "API key", description: "From hello.example.com", required: true, sensitive: true } },
});
const extensionZip = () => makeZip([
  { name: "manifest.json", data: extensionManifest },
  { name: "server/index.js", data: "console.log('hello');" },
]);
const pluginZip = () => makeZip([
  { name: ".claude-plugin/plugin.json", data: JSON.stringify({ name: "team-tools", displayName: "Team Tools", version: "1.2.0", description: "Team routines." }) },
  { name: "skills/standup/SKILL.md", data: "---\nname: standup\ndescription: Run standup\n---\nAsk each person.\n" },
  { name: ".mcp.json", data: JSON.stringify({ mcpServers: { "team-search": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/search.js"] } } }) },
]);

afterEach(() => vi.unstubAllGlobals());

describe("text and files", () => {
  it("reads a pasted MCP config into a waiting draft, installing nothing", async () => {
    const { api } = await harness();
    const result = await api.fromText(mcpConfig, null);
    expect(result.notes).toEqual([]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      kind: "mcp",
      name: "filesystem",
      source: "Pasted text",
      transport: "stdio",
      endpoint: "npx",
      installable: true,
      problem: null,
      operations: 0,
    });
    const pending = api.take(result.added[0]!.handle);
    expect(pending?.install).toBeNull();
    expect(pending?.draft.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"]);
    expect(pending?.draft.env).toEqual({ LOG_LEVEL: "info" });
    expect(api.views()).toHaveLength(1);
    api.drop(result.added[0]!.handle);
    expect(api.views()).toEqual([]);
    expect(api.take(result.added[0]!.handle)).toBeNull();
  });

  it("names a pasted OpenAPI description after the document, and a file after itself", async () => {
    const { api } = await harness();
    const pasted = await api.fromText(openApiSpec, null);
    expect(pasted.added[0]).toMatchObject({ kind: "openapi", name: "Issue Tracker", endpoint: "https://issues.example.com/v1", operations: 1, version: "2.0.0" });
    const directory = await temp();
    const file = join(directory, "issue-tracker.json");
    await writeFile(file, openApiSpec);
    const fromFile = await api.fromPath(file);
    expect(fromFile.added[0]).toMatchObject({ kind: "openapi", name: "issue-tracker", source: "Imported file: issue-tracker.json" });
  });

  it("answers an unrecognised document with advice rather than an exception", async () => {
    const { api } = await harness();
    const result = await api.fromText("hello world", null);
    expect(result.added).toEqual([]);
    expect(result.notes[0]).toContain("does not recognise this document");
    const named = await api.fromText("hello world", "notes.txt");
    expect(named.notes[0]).toContain("notes.txt");
  });

  it("reads a ChatGPT plugin manifest and then its OpenAPI description over the network", async () => {
    const fetch = stubFetch((url) => {
      expect(url).toBe("https://todos.example.com/openapi.json");
      return serve(openApiSpec.replace("Issue Tracker", "Todos"));
    });
    const { api } = await harness();
    const manifest = JSON.stringify({
      schema_version: "v1",
      name_for_model: "todos",
      name_for_human: "Todos",
      description_for_human: "Manage your todos.",
      api: { type: "openapi", url: "https://todos.example.com/openapi.json" },
      auth: { type: "service_http", authorization_type: "bearer" },
    });
    const result = await api.fromText(manifest, "ai-plugin.json");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.added[0]).toMatchObject({ kind: "openapi", name: "Todos", endpoint: "https://issues.example.com/v1" });
    expect(result.added[0]?.values.map(value => value.key)).toContain("token");
    expect(api.take(result.added[0]!.handle)?.draft.spec).toContain("Todos");
  });
});

describe("folders and archives", () => {
  async function pluginFolder(): Promise<string> {
    const folder = await temp("adcode-plugin-");
    await mkdir(join(folder, ".claude-plugin"), { recursive: true });
    await mkdir(join(folder, "skills", "standup"), { recursive: true });
    await writeFile(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "team-tools", displayName: "Team Tools", version: "1.2.0", description: "Team routines." }));
    await writeFile(join(folder, "skills", "standup", "SKILL.md"), "---\nname: standup\ndescription: Run standup\n---\nAsk each person.\n");
    await writeFile(join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { "team-search": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/search.js"] } } }));
    return folder;
  }

  it("reads a plugin folder with its skills and servers, and remembers where its files are", async () => {
    const folder = await pluginFolder();
    const { api } = await harness();
    const result = await api.fromPath(folder);
    expect(result.notes).toEqual([]);
    const draft = result.added[0]!;
    expect(draft).toMatchObject({ kind: "plugin", name: "Team Tools", version: "1.2.0", skills: ["skills/standup"], installable: true });
    expect(draft.servers).toEqual([{ name: "team-search", transport: "stdio" }]);
    expect(api.take(draft.handle)?.install).toMatchObject({ kind: "plugin", slug: "team-tools", from: "folder", path: folder });
  });

  it("offers only the plugins a marketplace folder actually holds", async () => {
    const root = await temp("adcode-marketplace-");
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
      name: "team-marketplace",
      plugins: [
        { name: "team-tools", source: "./plugins/team-tools" },
        { name: "far-away", source: { source: "github", repo: "example/plugins" } },
      ],
    }));
    await mkdir(join(root, "plugins", "team-tools", ".claude-plugin"), { recursive: true });
    await writeFile(join(root, "plugins", "team-tools", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "team-tools", version: "1.0.0" }));
    const { api } = await harness();
    const result = await api.fromPath(root);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ kind: "plugin", name: "team-tools" });
    expect(api.take(result.added[0]!.handle)?.install).toMatchObject({ from: "folder", path: join(root, "plugins", "team-tools") });
  });

  it("reads an extension folder picked by its manifest.json", async () => {
    const folder = await temp("adcode-extension-");
    await mkdir(join(folder, "server"), { recursive: true });
    await writeFile(join(folder, "manifest.json"), extensionManifest);
    await writeFile(join(folder, "server", "index.js"), "console.log('hello');");
    const { api } = await harness();
    const result = await api.fromPath(join(folder, "manifest.json"));
    expect(result.added[0]).toMatchObject({ kind: "extension", name: "Hello Tools", installable: true });
    expect(result.added[0]?.values.map(value => value.key)).toEqual(["API_KEY"]);
    expect(api.take(result.added[0]!.handle)?.install).toMatchObject({ kind: "extension", slug: "hello-tools", from: "folder", path: folder });
  });

  it("tells a plugin zip from an extension archive, and installs it as what it holds", async () => {
    const directory = await temp();
    const { api } = await harness();
    const extensionFile = join(directory, "hello.mcpb");
    await writeFile(extensionFile, extensionZip());
    const extension = await api.fromPath(extensionFile);
    expect(extension.added[0]).toMatchObject({ kind: "extension", name: "Hello Tools" });
    const extensionPlan = api.take(extension.added[0]!.handle)!.install!;
    expect(extensionPlan).toMatchObject({ kind: "extension", slug: "hello-tools", from: "bytes" });
    expect(isArchiveBytes((extensionPlan as { bytes: Uint8Array }).bytes)).toBe(true);

    // A plugin in a .zip: the name must not decide the kind - the contents do.
    const pluginFile = join(directory, "plugins.zip");
    await writeFile(pluginFile, pluginZip());
    const plugin = await api.fromPath(pluginFile);
    expect(plugin.added[0]).toMatchObject({ kind: "plugin", name: "Team Tools", skills: ["skills/standup"] });
    expect(api.take(plugin.added[0]!.handle)?.install).toMatchObject({ kind: "plugin", slug: "team-tools", from: "bytes" });
  });

  it("says plainly when a folder holds nothing it can read", async () => {
    const folder = await temp();
    const { api } = await harness();
    const result = await api.fromPath(folder);
    expect(result.added).toEqual([]);
    expect(result.notes[0]).toContain("not a Claude Desktop extension");
  });
});

describe("links", () => {
  it("refuses plain HTTP, credentials and non-addresses before any request", async () => {
    const fetch = stubFetch(() => serve("{}"));
    const { api } = await harness();
    expect((await api.fromUrl("http://example.com/mcp.json")).notes[0]).toContain("HTTPS");
    expect((await api.fromUrl("nope")).notes[0]).toContain("not a web address");
    expect((await api.fromUrl("https://user:pass@example.com/mcp.json")).notes[0]).toContain("credentials");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a config served over the network", async () => {
    stubFetch(() => serve(mcpConfig));
    const { api } = await harness();
    const result = await api.fromUrl("https://cfg.example.com/mcp.json");
    expect(result.added[0]).toMatchObject({ kind: "mcp", name: "filesystem", source: "Imported link: cfg.example.com" });
  });

  it("reads a .mcpb download as an extension", async () => {
    stubFetch(() => serve(extensionZip(), "application/zip"));
    const { api } = await harness();
    const result = await api.fromUrl("https://ext.example.com/hello-tools.mcpb");
    expect(result.added[0]).toMatchObject({ kind: "extension", name: "Hello Tools", source: "Imported link: ext.example.com" });
    expect(api.take(result.added[0]!.handle)?.install).toMatchObject({ kind: "extension", slug: "hello-tools", from: "bytes" });
  });

  it("reports a server that answers with an error instead of a document", async () => {
    stubFetch(() => new Response("nope", { status: 500, statusText: "Server Error" }));
    const { api } = await harness();
    const result = await api.fromUrl("https://cfg.example.com/mcp.json");
    expect(result.added).toEqual([]);
    expect(result.notes[0]).toContain("500");
  });
});

describe("scanning this computer", () => {
  it("finds Claude Desktop, Claude Code, Cursor, the open project, and installed extensions", async () => {
    const home = await temp("adcode-home-");
    const appData = await temp("adcode-appdata-");
    const workspace = await temp("adcode-workspace-");
    await writeFile(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "code-search": { command: "npx", args: ["-y", "search"] } } }));
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { "cursor-tools": { command: "node", args: ["cursor.js"] } } }));
    await mkdir(join(appData, "Claude"), { recursive: true });
    await writeFile(join(appData, "Claude", "claude_desktop_config.json"), JSON.stringify({ mcpServers: { "desktop-tools": { command: "node", args: ["desktop.js"] } } }));
    await mkdir(join(appData, "Claude", "Extensions", "hello"), { recursive: true });
    await writeFile(join(appData, "Claude", "Extensions", "hello", "manifest.json"), extensionManifest);
    await mkdir(join(appData, "Claude", "Extensions", "hello", "server"), { recursive: true });
    await writeFile(join(appData, "Claude", "Extensions", "hello", "server", "index.js"), "console.log('hello');");
    await writeFile(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { "project-tools": { command: "node", args: ["project.js"] } } }));

    const { api } = await harness({ home, appData, workspace });
    const result = await api.scan();
    expect(result.notes).toEqual([]);
    expect(result.added.map(draft => draft.name)).toEqual(["desktop-tools", "code-search", "cursor-tools", "project-tools", "Hello Tools"]);
    expect(result.added.map(draft => draft.source)).toEqual([
      "Claude Desktop",
      "Claude Code",
      "Cursor",
      "Claude Code: this project's .mcp.json",
      "Claude Desktop extension: hello",
    ]);
    const extension = api.take(result.added[4]!.handle)!;
    expect(extension.install).toMatchObject({ kind: "extension", from: "folder", path: join(appData, "Claude", "Extensions", "hello") });
  });

  it("says so when there is nothing to find", async () => {
    const { api } = await harness();
    const result = await api.scan();
    expect(result.added).toEqual([]);
    expect(result.notes[0]).toContain("No connectors were found");
  });
});
