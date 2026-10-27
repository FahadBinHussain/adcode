import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorDraft } from "@adcode/connect";
import { createAssistantControlsService, parseAssistantServer, type AssistantConnectRequest, type McpSession, type RemoteTool } from "../src/main/assistantControlsService.ts";
import type { ConnectorSecretStore } from "../src/main/connectorSecrets.ts";
import type { ConnectorSources, PendingDraft } from "../src/main/connectorImport.ts";
import { discoverSkills, installedSkillRoots, parseSkill } from "../src/main/assistantSkills.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp() { const path = await mkdtemp(join(tmpdir(), "adcode-controls-")); directories.push(path); return path; }
const server = { id: "test-server", name: "Test server", transport: "stdio" as const, endpoint: "test-executable", args: ["--mcp"] };
const remoteTool: RemoteTool = { name: "find_issues", description: "Search project issues", inputSchema: { type: "object", properties: { query: { type: "string" } } } };
const skillText = "---\nname: review-code\ndescription: Review code for bugs\n---\nRead the changed files and check their callers.\n";

/** An in-memory stand-in for the OS-encrypted store. */
function fakeSecrets(): ConnectorSecretStore {
  const stored = new Map<string, Record<string, string>>();
  return {
    read: async (id) => ({ ...(stored.get(id) ?? {}) }),
    write: async (id, values) => { if (Object.keys(values).length === 0) stored.delete(id); else stored.set(id, { ...values }); },
    clear: async (id) => { stored.delete(id); },
  };
}

/** No imports waiting, for tests that never touch the Add dialog. */
function emptySources(): ConnectorSources {
  return {
    scan: async () => ({ added: [], notes: [] }),
    fromPath: async () => ({ added: [], notes: [] }),
    fromUrl: async () => ({ added: [], notes: [] }),
    fromText: async () => ({ added: [], notes: [] }),
    views: () => [],
    take: () => null,
    drop: () => undefined,
  };
}

async function setup() {
  const directory = await temp();
  let root: string | null = directory;
  let closed = () => {};
  const session: McpSession = { list: vi.fn(async () => [remoteTool]), call: vi.fn(async () => ({ content: "Found 2 issues", isError: false })), close: vi.fn(async () => {}) };
  const connect = vi.fn(async (_request: AssistantConnectRequest, onClose: () => void) => { closed = onClose; return session; });
  const confirm = vi.fn(async (_title: string, _detail: string, _signal?: AbortSignal) => true);
  const deps = { directory, workspace: () => root, connect, confirm, secrets: fakeSecrets(), sources: emptySources(), install: vi.fn(async () => join(directory, "installed")) };
  const service = createAssistantControlsService(deps);
  const run = (name: string, input: Record<string, unknown>, signal = new AbortController().signal) => service.runner.run({ type: "tool-call", id: "call", name, input }, signal);
  const saveConnect = async () => {
    await service.action({ kind: "save-server", server });
    await service.action({ kind: "connect", id: server.id });
  };
  const enable = (enabled = true) => service.action({ kind: "set-tool", id: server.id, tool: remoteTool.name, enabled });
  return { directory, service, session, connect, confirm, run, saveConnect, enable, deps, setRoot: (value: string | null) => { root = value; }, disconnectRemotely: () => closed() };
}

describe("assistant capability controls", () => {
  it("creates disabled workspace skills without overwriting existing files or accepting path traversal", async () => {
    const t = await setup();
    const action = { kind: "create-skill", name: "review-code", description: "Review changes", instructions: "Check the changed files." };
    const view = await t.service.action(action);
    expect(view.skills[0]).toMatchObject({ name: "review-code", enabled: false });
    const path = join(t.directory, ".adcode", "skills", "review-code", "SKILL.md");
    expect(await readFile(path, "utf8")).toContain("Check the changed files.");
    await expect(t.service.action(action)).rejects.toThrow();
    await expect(t.service.action({ ...action, name: "../escape" })).rejects.toThrow("hyphenated");
  });
  it("saves without starting a process, exposes no tools until enabled, and persists permissions without auto-connect", async () => {
    const t = await setup();
    await t.service.action({ kind: "save-server", server });
    expect(t.connect).not.toHaveBeenCalled();
    await t.service.action({ kind: "connect", id: server.id });
    expect(JSON.parse((await t.run("discover_capabilities", { query: "issues" })).content).matches).toEqual([]);
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
    await t.enable();
    const discovery = JSON.parse((await t.run("discover_capabilities", { query: "issues" })).content);
    expect(discovery.matches[0]).toMatchObject({ kind: "mcp", server: server.id, inputSchema: remoteTool.inputSchema });
    const restarted = createAssistantControlsService({ ...t.deps, workspace: () => t.directory });
    expect((await restarted.snapshot()).servers[0]?.status).toBe("disconnected");
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect((await readFile(join(t.directory, "assistant-controls.json"), "utf8"))).toContain("find_issues");
  });

  it("runs an enabled tool without a dialog when Ask before connector tools is off, and still refuses a disabled one", async () => {
    const t = await setup();
    const service = createAssistantControlsService({ ...t.deps, askBeforeCalls: () => false });
    await service.action({ kind: "save-server", server });
    await service.action({ kind: "connect", id: server.id });
    const call = () => service.runner.run({ type: "tool-call", id: "call", name: "call_mcp", input: { server: server.id, tool: remoteTool.name, arguments: {} } }, new AbortController().signal);
    expect((await call()).isError).toBe(true);
    await service.action({ kind: "set-tool", id: server.id, tool: remoteTool.name, enabled: true });
    expect(await call()).toEqual({ content: "Found 2 issues", isError: false });
    // Starting a local program still asks; the tool call itself never did.
    expect(t.confirm.mock.calls.map((call) => call[0])).toEqual(["Connect Test server?"]);
  });

  it("confirms exact arguments and records actual call outcome and timing", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: { query: "bug" } });
    expect(output).toEqual({ content: "Found 2 issues", isError: false });
    expect(t.confirm.mock.calls.at(-1)?.[1]).toContain('{"query":"bug"}');
    const view = (await t.service.snapshot()).servers[0]?.tools[0];
    expect(view?.calls).toBe(1);
    expect(view?.lastDurationMs).toBeGreaterThanOrEqual(0);
    expect(view?.lastError).toBeNull();
  });

  it("rechecks permissions after approval and prevents disabled tools from running", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockImplementationOnce(async () => { await t.enable(false); return true; });
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} });
    expect(output.isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("cancels when the project changes during approval, or when the signal is aborted", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockImplementationOnce(async () => { t.setRoot(null); return true; });
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    const abort = new AbortController(); abort.abort();
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} }, abort.signal)).isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("declines calls and revokes tools when a server disconnects", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockResolvedValueOnce(false);
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    t.disconnectRemotely();
    expect((await t.service.snapshot()).servers[0]?.status).toBe("disconnected");
    expect(JSON.parse((await t.run("discover_capabilities", { query: "" })).content).matches).toEqual([]);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("surfaces connection errors and invalidates permission after schema changes", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    vi.mocked(t.session.list).mockResolvedValueOnce([{ ...remoteTool, description: "Now also changes issues" }]);
    await t.service.action({ kind: "connect", id: server.id });
    expect((await t.service.snapshot()).servers[0]?.tools[0]?.enabled).toBe(false);
    t.connect.mockRejectedValueOnce(new Error("Server unreachable"));
    await t.service.action({ kind: "connect", id: server.id });
    expect((await t.service.snapshot()).servers[0]).toMatchObject({ status: "error", error: "Server unreachable", tools: [] });
  });

  it("bounds tool output and reports remote failures without claiming success", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    vi.mocked(t.session.call).mockResolvedValueOnce({ content: "x".repeat(80_000), isError: true });
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} });
    expect(output.content.length).toBeLessThan(24_200);
    expect(output.content).toContain("Truncated");
    expect((await t.service.snapshot()).servers[0]?.tools[0]?.lastError).not.toBeNull();
  });

  it("discovers, previews and activates project skills; changes require activation again", async () => {
    const t = await setup();
    const folder = join(t.directory, ".agents", "skills", "review-code");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), skillText);
    const id = ".agents/skills/review-code/SKILL.md";
    expect((await t.service.snapshot()).skills[0]).toMatchObject({ enabled: false, name: "review-code", error: null });
    expect(await t.service.previewSkill(id)).toBe(skillText);
    expect((await t.run("load_skill", { id })).isError).toBe(true);
    await t.service.action({ kind: "set-skill", id, enabled: true });
    expect((await t.run("load_skill", { id })).content).toContain("check their callers");
    expect(JSON.parse((await t.run("discover_capabilities", { query: "review" })).content).matches[0].kind).toBe("skill");
    await writeFile(join(folder, "SKILL.md"), skillText + "Changed instructions.");
    expect((await t.service.snapshot()).skills[0]?.error).toContain("Changed since activation");
    expect((await t.run("load_skill", { id })).isError).toBe(true);
    await t.service.action({ kind: "set-skill", id, enabled: true });
    expect((await t.run("load_skill", { id })).content).toContain("Changed instructions.");
    t.setRoot(await temp());
    expect((await t.service.snapshot()).skills).toEqual([]);
    await expect(t.service.previewSkill(id)).rejects.toThrow("not found");
  });

  it("handles corrupt preferences visibly without overwriting them on read", async () => {
    const directory = await temp();
    const file = join(directory, "assistant-controls.json");
    await writeFile(file, "{bad");
    const service = createAssistantControlsService({ directory, workspace: () => null, connect: vi.fn(), confirm: vi.fn(), secrets: fakeSecrets(), sources: emptySources(), install: vi.fn() });
    expect((await service.snapshot()).notice).toContain("could not be read");
    expect(await readFile(file, "utf8")).toBe("{bad");
  });

  it("rejects invalid renderer input and non-local plaintext remote URLs", async () => {
    expect(() => parseAssistantServer({ ...server, transport: "http", endpoint: "http://example.com/mcp" })).toThrow("HTTPS");
    expect(() => parseAssistantServer({ ...server, transport: "http", endpoint: "https://example.com/mcp?token=secret" })).toThrow("credentials");
    expect(() => parseAssistantServer({ ...server, args: [4] })).toThrow("Arguments");
    expect(parseAssistantServer({ ...server, transport: "http", endpoint: "http://127.0.0.1:4567/mcp" }).transport).toBe("http");
    const t = await setup();
    await expect(t.service.action({ kind: "save-server", server: { ...server, id: "../escape" } })).rejects.toThrow("hyphenated");
    await expect(t.service.action({ kind: "unknown", id: server.id })).rejects.toThrow();
  });
});

describe("skill format and containment", () => {
  it("finds user and bundled system skills without an open project", async () => {
    const home = await temp();
    const path = join(home, ".codex", "skills", ".system", "review-code");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), skillText);
    const roots = await installedSkillRoots(home);
    const skills = await discoverSkills(null, {}, roots);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "review-code", scope: "system", source: "Codex system", enabled: false });
    expect(skills[0]?.id).toMatch(/^system:/);
    expect(await installedSkillRoots(home, join(home, "custom"))).toContainEqual({ path: join(home, "custom", "skills"), source: "Codex" });
  });
  it("keeps duplicate skill names distinct across installations and the project", async () => {
    const home = await temp();
    const project = await temp();
    for (const folder of [join(home, ".claude", "skills", "review-code"), join(home, ".agents", "skills", "review-code"), join(project, ".agents", "skills", "review-code")]) {
      await mkdir(folder, { recursive: true }); await writeFile(join(folder, "SKILL.md"), skillText);
    }
    const found = await discoverSkills(project, {}, await installedSkillRoots(home));
    expect(found).toHaveLength(3);
    expect(new Set(found.map(skill => skill.id)).size).toBe(3);
    expect(found[0]?.scope).toBe("workspace");
  });
  it("persists system activation across projects and confines supporting-file reads", async () => {
    const home = await temp();
    const folder = join(home, ".adcode", "skills", "review-code");
    await mkdir(join(folder, "references"), { recursive: true });
    await writeFile(join(folder, "SKILL.md"), skillText);
    await writeFile(join(folder, "references", "checks.md"), "Check caller behavior.");
    let workspace: string | null = null;
    const directory = await temp();
    const service = createAssistantControlsService({ directory, workspace: () => workspace, installedSkills: async () => installedSkillRoots(home), connect: vi.fn(), confirm: vi.fn(), secrets: fakeSecrets(), sources: emptySources(), install: vi.fn() });
    const id = (await service.snapshot()).skills[0]!.id;
    await service.action({ kind: "set-skill", id, enabled: true });
    workspace = await temp();
    expect((await service.snapshot()).skills[0]?.enabled).toBe(true);
    const run = (resource: string) => service.runner.run({ type: "tool-call", id: "test", name: "load_skill", input: { id, resource } }, new AbortController().signal);
    expect((await run("references/checks.md")).content).toContain("Check caller behavior.");
    await expect(run("../secret.txt")).rejects.toThrow("outside");
    await service.action({ kind: "set-skill", id, enabled: false });
    expect((await run("references/checks.md")).isError).toBe(true);
    expect((await readFile(join(folder, "SKILL.md"), "utf8"))).toBe(skillText);
  });
  it("reads CRLF, quoted, and folded metadata and rejects missing fields", () => {
    expect(parseSkill(skillText.replaceAll("\n", "\r\n")).name).toBe("review-code");
    expect(parseSkill('---\nname: "review-code"\ndescription: >-\n  Review code\n  for bugs\n---\nBody').description).toBe("Review code for bugs");
    expect(() => parseSkill("No metadata")).toThrow("frontmatter");
    expect(() => parseSkill("---\nname: review-code\n---\nBody")).toThrow("description");
  });
  it("refuses skill folders redirected outside the workspace", async () => {
    const directory = await temp();
    const outside = await temp();
    await mkdir(join(directory, ".agents"));
    await mkdir(join(outside, "review-code"));
    await writeFile(join(outside, "review-code", "SKILL.md"), skillText);
    await symlink(outside, join(directory, ".agents", "skills"), process.platform === "win32" ? "junction" : "dir");
    expect(await discoverSkills(directory, {})).toEqual([]);
  });
});

/* ── Imported drafts, through the Add dialog ───────────────────────────────── */

/** Pending drafts served by a stand-in for the import module; `drop` is what add consumes. */
function draftSources(pending: PendingDraft[]): ConnectorSources {
  return {
    scan: async () => ({ added: [], notes: [] }),
    fromPath: async () => ({ added: [], notes: [] }),
    fromUrl: async () => ({ added: [], notes: [] }),
    fromText: async () => ({ added: [], notes: [] }),
    views: () => [],
    take: (handle) => pending.find(entry => entry.handle === handle) ?? null,
    drop: (handle) => { const at = pending.findIndex(entry => entry.handle === handle); if (at >= 0) pending.splice(at, 1); },
  };
}

const mcpDraft: ConnectorDraft = {
  kind: "mcp", name: "Files", slug: "files", purpose: "Reads files.", source: "Claude Desktop", origin: "import",
  transport: "stdio", endpoint: "npx", args: ["-y", "files-server"], env: { API_KEY: "from-file" }, headers: {},
  values: [], spec: null, auth: null, skills: [], servers: [], warnings: [], homepage: null,
};
const openApiText = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Todos", version: "1.0.0" },
  servers: [{ url: "https://todos.example.com" }],
  paths: { "/todos": { get: { operationId: "listTodos", summary: "List todos" } } },
});
const openApiDraft: ConnectorDraft = {
  kind: "openapi", name: "Todos", slug: "todos", purpose: "Calls Todos 1.0.0.", source: "Imported link: todos.example.com", origin: "actions",
  transport: "http", endpoint: "", args: [], env: {}, headers: {},
  values: [
    { key: "token", label: "API token", hint: null, required: true, secret: true, preset: null },
    { key: "__base_url", label: "Server address", hint: null, required: true, secret: false, preset: null },
  ],
  spec: openApiText, auth: { kind: "bearer", name: null, needsToken: true }, skills: [], servers: [], warnings: [], homepage: null,
};
const extensionDraft: ConnectorDraft = {
  kind: "extension", name: "Hello Tools", slug: "hello-tools", purpose: "Says hello.", source: "Extension file: hello.mcpb", origin: "extension",
  transport: "stdio", endpoint: "node", args: ["${__dirname}/server/index.js"], env: {}, headers: {},
  values: [{ key: "API_KEY", label: "API key", hint: "From hello.example.com", required: true, secret: true, preset: null }],
  spec: null, auth: null, skills: [], servers: [], warnings: [], homepage: null,
};
const pluginDraft: ConnectorDraft = {
  kind: "plugin", name: "Team Tools", slug: "team-tools", purpose: "Team routines.", source: "Plugin folder: team-tools", origin: "plugin",
  transport: "stdio", endpoint: "", args: [], env: {}, headers: {}, values: [], spec: null, auth: null,
  skills: ["skills/standup"],
  servers: [{ name: "Team search", slug: "team-search", transport: "stdio", endpoint: "node", args: ["${CLAUDE_PLUGIN_ROOT}/search.js"], env: { SEARCH_KEY: "${CLAUDE_PLUGIN_ROOT}/key.txt" }, headers: {}, warnings: [] }],
  warnings: [], homepage: null,
};

describe("imported connectors through the Add dialog", () => {
  let counter = 0;
  const pendingDraft = (draft: ConnectorDraft, overrides: Partial<PendingDraft> = {}): PendingDraft => ({
    handle: `draft-${(counter++).toString(16).padStart(4, "0")}`, draft, install: null, problem: null, operations: 0, version: null, createdAt: Date.now(), ...overrides,
  });

  async function setup(pending: PendingDraft[], secrets: ConnectorSecretStore = fakeSecrets()) {
    const directory = await temp();
    const installed: string[] = [];
    const removed: string[] = [];
    const session: McpSession = { list: vi.fn(async () => [remoteTool]), call: vi.fn(async () => ({ content: "ok", isError: false })), close: vi.fn(async () => {}) };
    const connect = vi.fn(async (_request: AssistantConnectRequest, _onClose: () => void) => session);
    const install = vi.fn(async (item: PendingDraft) => {
      const target = join(await temp(), item.draft.slug);
      await mkdir(target, { recursive: true });
      installed.push(target);
      return target;
    });
    const service = createAssistantControlsService({
      directory,
      workspace: () => directory,
      connect,
      confirm: vi.fn(async () => true),
      secrets,
      sources: draftSources(pending),
      install,
      removeInstall: vi.fn(async (path: string) => { removed.push(path); }),
    });
    return { directory, service, connect, secrets, install, installed, removed };
  }

  it("turns an imported MCP config into a connector, moving its values to the encrypted store", async () => {
    const pending = [pendingDraft(mcpDraft)];
    const t = await setup(pending);
    const view = await t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { EXTRA: "typed" } });
    expect(view.servers[0]).toMatchObject({ id: "files", kind: "mcp", origin: "import", source: "Claude Desktop", endpoint: "npx", valueKeys: ["API_KEY", "EXTRA"] });
    expect(await readFile(join(t.directory, "assistant-controls.json"), "utf8")).not.toContain("from-file");
    expect(pending).toEqual([]);
    await t.service.action({ kind: "connect", id: "files" });
    expect(t.connect.mock.calls[0]?.[0].values).toEqual({ API_KEY: "from-file", EXTRA: "typed" });
  });

  it("holds an OpenAPI connector until its token and address are answered", async () => {
    const pending = [pendingDraft(openApiDraft, { operations: 1, version: "1.0.0" })];
    const t = await setup(pending);
    await expect(t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { __base_url: "https://todos.example.com" } })).rejects.toThrow("needs its token");
    const view = await t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { token: "k", __base_url: "https://todos.example.com" } });
    expect(view.servers[0]).toMatchObject({ id: "todos", kind: "openapi", endpoint: "https://todos.example.com", transport: "http", valueKeys: ["__base_url", "token"] });
    expect(await t.secrets.read("todos")).toEqual({ token: "k", __base_url: "https://todos.example.com" });
    await t.service.action({ kind: "forget-values", id: "todos" });
    expect(await t.secrets.read("todos")).toEqual({});
    expect((await t.service.snapshot()).servers[0]?.valueKeys).toEqual([]);
  });

  it("refuses a draft the source could not complete", async () => {
    const pending = [pendingDraft(extensionDraft, { problem: "This is only the extension's manifest. Choose the .mcpb file itself." })];
    const t = await setup(pending);
    await expect(t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: {} })).rejects.toThrow("only the extension's manifest");
    await expect(t.service.action({ kind: "add-draft", handle: "draft-gone", values: {} })).rejects.toThrow("no longer waiting");
    expect(t.install).not.toHaveBeenCalled();
  });

  it("asks an extension's questions before its files are installed, then links the record to the folder", async () => {
    const pending = [pendingDraft(extensionDraft, { version: "1.0.0" })];
    const t = await setup(pending);
    await expect(t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { API_KEY: "" } })).rejects.toThrow("needed before this extension can be added");
    expect(t.install).not.toHaveBeenCalled();
    const view = await t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { API_KEY: "k" } });
    const record = view.servers[0]!;
    expect(record).toMatchObject({ id: "hello-tools", kind: "extension", version: "1.0.0", root: t.installed[0] });
    expect(record.valueKeys).toEqual(["API_KEY"]);
    await t.service.action({ kind: "connect", id: "hello-tools" });
    const request = t.connect.mock.calls[0]![0];
    // The placeholder is replaced with the install folder; the template's own slash stays.
    expect(request.server.args).toEqual([`${t.installed[0]!}/server/index.js`]);
    expect(request.values).toEqual({ API_KEY: "k" });
  });

  it("puts a plugin, its skills and its own servers in place, resolving the plugin root", async () => {
    const pending = [pendingDraft(pluginDraft, { version: "1.2.0" })];
    const t = await setup(pending);
    const view = await t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: {} });
    expect(view.servers.map(server => server.id)).toEqual(["team-tools", "team-tools-team-search"]);
    const [container, server] = view.servers;
    expect(container).toMatchObject({ kind: "plugin", root: t.installed[0], version: "1.2.0" });
    expect(server).toMatchObject({ kind: "mcp", origin: "plugin", source: "Plugin: Team Tools" });
    expect(server?.endpoint).toBe("node");
    expect(server?.args).toEqual([`${t.installed[0]!}/search.js`]);
    await expect(t.service.action({ kind: "connect", id: "team-tools" })).rejects.toThrow("separate connectors");
    await t.service.action({ kind: "connect", id: "team-tools-team-search" });
    expect(t.connect.mock.calls[0]?.[0].values).toEqual({ SEARCH_KEY: `${t.installed[0]!}/key.txt` });

    await t.service.action({ kind: "remove-server", id: "team-tools" });
    expect(t.removed).toEqual([t.installed[0]]);
    expect((await t.service.snapshot()).servers).toEqual([]);
  });

  it("reclaims the installed folder when saving fails after the files landed", async () => {
    const directory = await temp();
    const store = fakeSecrets();
    const failing: ConnectorSecretStore = { ...store, write: async () => { throw new Error("The store refused the write."); } };
    const pending = [pendingDraft(extensionDraft, { version: "1.0.0" })];
    const t = await setup(pending, failing);
    await expect(t.service.action({ kind: "add-draft", handle: pending[0]!.handle, values: { API_KEY: "k" } })).rejects.toThrow("refused the write");
    expect(t.removed).toEqual([t.installed[0]]);
    expect(pending).toHaveLength(1);
    expect(directory.length).toBeGreaterThan(0);
  });
});
