/**
 * Finding the connectors other AI tools already have, and reading whatever file a person
 * hands over.
 *
 * This is the only part of the import flow that touches the disk and the network. It
 * reduces everything - a Claude Desktop config, a project's `.mcp.json`, a VS Code or
 * Cursor `mcp.json`, an `ai-plugin.json` with its OpenAPI URL, a `.mcpb` archive, a
 * Claude Code plugin folder or zip, a marketplace - to `ConnectorDraft`s, each with the
 * facts the Add dialog shows and, when there are files to install, a `PendingInstall`
 * that remembers where they came from.
 *
 * Reading is separated from installing on purpose: nothing is copied or unpacked until
 * the person actually presses Add. Until then a draft is a few kilobytes of JSON and a
 * handle into an in-memory registry that forgets everything after half an hour.
 *
 * The parsing itself lives in `@adcode/connect`; this file is the I/O half - reading
 * capped file contents, fetching over HTTPS, and walking plugin folders.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  actionsDraft,
  detectDocument,
  draftsFromAiPlugin,
  mcpbDraft,
  nestedServers,
  parseAiPlugin,
  parseMarketplace,
  parseMcpbManifest,
  parseMcpServersDocument,
  parseOpenApi,
  parsePluginManifest,
  pluginDraft,
  readZipDirectory,
  readZipEntry,
  slugify,
  type ClaudePluginManifest,
  type ConnectorDraft,
  type ZipEntry,
} from "@adcode/connect";
import type { AssistantTransport, ConnectorDraftView } from "../shared/assistantControls.ts";
import { contentPrefix } from "./connectorInstall.ts";

/** A config or description read from a file. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Claude Code keeps its whole history in `~/.claude.json`; only `mcpServers` is wanted. */
const MAX_CLAUDE_CODE_BYTES = 64 * 1024 * 1024;
/** A `.mcpb` download - bundling `node_modules` is normal. */
const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** Drafts waiting in the dialog at once, and how long an unadded one lives. */
const MAX_PENDING = 60;
const PENDING_TTL_MS = 30 * 60_000;

/** Where the files of an extension or plugin came from, kept until Add is pressed. */
export type PendingInstall =
  | { readonly kind: "extension" | "plugin"; readonly slug: string; readonly from: "folder"; readonly path: string }
  | { readonly kind: "extension" | "plugin"; readonly slug: string; readonly from: "archive"; readonly path: string }
  | { readonly kind: "extension" | "plugin"; readonly slug: string; readonly from: "bytes"; readonly bytes: Uint8Array };

export interface PendingDraft {
  readonly handle: string;
  readonly draft: ConnectorDraft;
  readonly install: PendingInstall | null;
  /** Why this cannot be added as it is, or null when it can. */
  readonly problem: string | null;
  /** OpenAPI drafts: how many operations the description holds. */
  readonly operations: number;
  readonly version: string | null;
  readonly createdAt: number;
}

export interface ImportResult {
  /** The drafts this call added, for the dialog to highlight. */
  readonly added: readonly ConnectorDraftView[];
  /** Plain sentences about anything skipped, for the page's notice. */
  readonly notes: string[];
}

export interface ConnectorSources {
  /** Known locations on this computer: Claude Desktop, Claude Code, Cursor, Windsurf, VS Code. */
  scan(): Promise<ImportResult>;
  /** A file or folder the person chose. */
  fromPath(path: string): Promise<ImportResult>;
  /** A URL the person pasted. */
  fromUrl(url: string): Promise<ImportResult>;
  /** Text the person pasted. */
  fromText(text: string, fileName: string | null): Promise<ImportResult>;
  /** Everything still waiting, oldest first. */
  views(): readonly ConnectorDraftView[];
  /** The pending draft for a handle, or null when it expired. */
  take(handle: string): PendingDraft | null;
  drop(handle: string): void;
}

export interface ConnectorSourceDeps {
  readonly home: string;
  /** Electron's `appData`: covers Windows, macOS and Linux config folders. */
  readonly appData: string;
  readonly workspace: () => string | null;
}

export function isArchiveBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function fetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a web address.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("ADCode only fetches connectors over HTTPS (or HTTP from this computer).");
  if (url.username !== "" || url.password !== "") throw new Error("Remove the credentials from that URL and add them as a value instead.");
  return url;
}

async function fetchCapped(url: URL, maxBytes: number, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; url: string; contentType: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error("timed out")); }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { redirect: "follow", signal: controller.signal, headers: { Accept: "application/json, application/zip, text/plain;q=0.8, */*;q=0.5" } });
    if (!response.ok) throw new Error(`The server answered ${response.status.toString()} ${response.statusText}.`);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader !== undefined) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`That address serves more than ${Math.round(maxBytes / 1024 / 1024).toString()} MB.`);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { bytes, url: response.url !== "" ? response.url : url.toString(), contentType: response.headers.get("content-type") ?? "" };
  } catch (error) {
    if (timedOut) throw new Error("That address did not answer in time.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readTextFile(path: string): Promise<string> {
  const info = await stat(path);
  const limit = basename(path).toLowerCase() === ".claude.json" ? MAX_CLAUDE_CODE_BYTES : MAX_TEXT_BYTES;
  if (info.size > limit) throw new Error(`${basename(path)} is larger than ${Math.round(limit / 1024 / 1024).toString()} MB.`);
  return readFile(path, "utf8");
}

async function readArchive(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error(`${basename(path)} is larger than ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024).toString()} MB.`);
  return readFile(path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listDirectory(path: string): Promise<{ name: string; directory: boolean }[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter(entry => !entry.isSymbolicLink()).map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
}

/* ── Plugin folders ────────────────────────────────────────────────────────── */

interface PluginContentsRead {
  readonly draft: ConnectorDraft;
  readonly version: string | null;
}

async function readPluginFolder(path: string, source: string): Promise<PluginContentsRead> {
  const manifestPath = join(path, ".claude-plugin", "plugin.json");
  let manifest: ClaudePluginManifest;
  if (await exists(manifestPath)) manifest = parsePluginManifest(await readTextFile(manifestPath), basename(path));
  else manifest = { name: slugify(basename(path), "plugin"), displayName: basename(path), version: null, description: "", homepage: null, license: null, author: null };

  const skills: string[] = [];
  for (const entry of await listDirectory(join(path, "skills"))) {
    if (entry.directory && await exists(join(path, "skills", entry.name, "SKILL.md"))) skills.push(`skills/${entry.name}`);
  }
  const commands: string[] = [];
  for (const entry of await listDirectory(join(path, "commands"))) if (!entry.directory && entry.name.endsWith(".md")) commands.push(`commands/${entry.name}`);
  const agents: string[] = [];
  for (const entry of await listDirectory(join(path, "agents"))) if (!entry.directory && entry.name.endsWith(".md")) agents.push(`agents/${entry.name}`);

  const mcpPath = join(path, ".mcp.json");
  const servers = await exists(mcpPath)
    ? nestedServers(parseMcpServersDocument(await readTextFile(mcpPath), { source: `${source} (plugin server)`, purpose: `An MCP server the plugin ${manifest.displayName} runs.` }).drafts)
    : [];

  return {
    draft: pluginDraft(
      { manifest, skills, commands, agents, hooks: await exists(join(path, "hooks", "hooks.json")), servers, source },
      manifest.homepage,
    ),
    version: manifest.version,
  };
}

function readPluginArchive(bytes: Uint8Array, entries: readonly ZipEntry[], prefix: string, source: string, slug: string): PluginContentsRead {
  const textAt = (name: string): string | null => {
    const entry = entries.find(candidate => candidate.name === `${prefix}${name}` && !candidate.directory);
    if (entry === undefined) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(readZipEntry(bytes, entry));
  };
  const manifestJson = textAt(".claude-plugin/plugin.json");
  const manifest = manifestJson !== null
    ? parsePluginManifest(manifestJson, slug)
    : { name: slug, displayName: slug, version: null, description: "", homepage: null, license: null, author: null };

  const skills = new Set<string>();
  for (const entry of entries) {
    if (entry.directory) continue;
    const relative = entry.name.slice(prefix.length);
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(relative);
    if (match !== null && match[1] !== undefined) skills.add(`skills/${match[1]}`);
  }
  const markdown = (folder: string): string[] => entries
    .filter(entry => !entry.directory && entry.name.startsWith(`${prefix}${folder}/`) && entry.name.endsWith(".md"))
    .map(entry => `${folder}/${entry.name.slice(`${prefix}${folder}/`.length)}`)
    .slice(0, 500);

  const mcpJson = textAt(".mcp.json");
  const servers = mcpJson !== null
    ? nestedServers(parseMcpServersDocument(mcpJson, { source: `${source} (plugin server)`, purpose: `An MCP server the plugin ${manifest.displayName} runs.` }).drafts)
    : [];

  return {
    draft: pluginDraft(
      {
        manifest,
        skills: [...skills],
        commands: markdown("commands"),
        agents: markdown("agents"),
        hooks: entries.some(entry => entry.name === `${prefix}hooks/hooks.json`),
        servers,
        source,
      },
      manifest.homepage,
    ),
    version: manifest.version,
  };
}

/* ── Extensions ────────────────────────────────────────────────────────────── */

interface ExtensionRead {
  readonly draft: ConnectorDraft;
  readonly version: string | null;
}

async function readExtensionFolder(path: string, source: string): Promise<ExtensionRead | null> {
  const manifestPath = join(path, "manifest.json");
  if (!await exists(manifestPath)) return null;
  let manifest;
  try {
    manifest = parseMcpbManifest(await readTextFile(manifestPath));
  } catch {
    return null;
  }
  if (!await exists(join(path, ...manifest.entryPoint.split("/")))) return null;
  return { draft: mcpbDraft(manifest, source), version: manifest.version };
}

function readExtensionArchive(bytes: Uint8Array, entries: readonly ZipEntry[], prefix: string, source: string): ExtensionRead | null {
  const manifestEntry = entries.find(entry => entry.name === `${prefix}manifest.json` && !entry.directory);
  if (manifestEntry === undefined) return null;
  let manifest;
  try {
    manifest = parseMcpbManifest(new TextDecoder("utf-8", { fatal: false }).decode(readZipEntry(bytes, manifestEntry)));
  } catch {
    return null;
  }
  if (!entries.some(entry => entry.name === `${prefix}${manifest.entryPoint}` && !entry.directory)) return null;
  return { draft: mcpbDraft(manifest, source), version: manifest.version };
}

/* ── Documents ─────────────────────────────────────────────────────────────── */

interface TextContext {
  readonly source: string;
  readonly fileName: string | null;
  readonly sourceUrl: string | null;
  readonly fallbackName: string | null;
}

interface ReadDraft {
  readonly draft: ConnectorDraft;
  readonly install: PendingInstall | null;
  readonly problem: string | null;
  readonly operations: number;
  readonly version: string | null;
}

async function draftsFromText(text: string, context: TextContext, fetchImpl: typeof fetch): Promise<ReadDraft[]> {
  const format = detectDocument(text, context.fileName);
  switch (format) {
    case "mcp-config": {
      const parsed = parseMcpServersDocument(text, {
        source: context.source,
        ...(context.fallbackName === null ? {} : { fallbackName: context.fallbackName }),
      });
      return parsed.drafts.map(draft => ({ draft, install: null, problem: null, operations: 0, version: null }));
    }
    case "openapi": {
      const doc = parseOpenApi(text, context.sourceUrl === null ? {} : { documentUrl: context.sourceUrl });
      // A file's name is a better label than the document's own title (petstore-api.json
      // beside three other APIs); pasted text has no file name, so the title stands.
      const name = context.fileName === null ? null : context.fallbackName;
      return [{
        draft: actionsDraft(text, doc, context.source, name),
        install: null,
        problem: null,
        operations: doc.operations.length,
        version: doc.version === "" ? null : doc.version,
      }];
    }
    case "ai-plugin": {
      const manifest = parseAiPlugin(text, context.sourceUrl);
      const spec = await fetchCapped(fetchableUrl(manifest.apiUrl), MAX_TEXT_BYTES, fetchImpl);
      const specText = new TextDecoder("utf-8", { fatal: false }).decode(spec.bytes);
      const doc = parseOpenApi(specText, { documentUrl: spec.url });
      return [{
        draft: draftsFromAiPlugin(text, specText, context.sourceUrl, context.source)[0]!,
        install: null,
        problem: null,
        operations: doc.operations.length,
        version: doc.version === "" ? null : doc.version,
      }];
    }
    case "mcpb-manifest": {
      const draft = mcpbDraft(parseMcpbManifest(text), context.source);
      return [{
        draft,
        install: null,
        problem: "This is only the extension's manifest. Choose the .mcpb file itself, or its folder, so its files come with it.",
        operations: 0,
        version: null,
      }];
    }
    case "claude-plugin": {
      const draft = { ...emptyPluginDraft(context.source), name: "Plugin manifest" };
      return [{
        draft,
        install: null,
        problem: "This is only the plugin's manifest. Choose the plugin's folder or its zip, so its skills and servers come with it.",
        operations: 0,
        version: null,
      }];
    }
    default:
      throw new Error(context.fileName !== null
        ? `ADCode does not recognise ${context.fileName}. It reads MCP server configs, OpenAPI descriptions, ChatGPT plugin manifests, Claude plugins and .mcpb extensions.`
        : "ADCode does not recognise this document. It reads MCP server configs, OpenAPI descriptions, ChatGPT plugin manifests, Claude plugins and .mcpb extensions.");
  }
}

/** A placeholder draft for a bare manifest, so the dialog can say what is missing. */
function emptyPluginDraft(source: string): ConnectorDraft {
  return {
    kind: "plugin",
    name: "Plugin",
    slug: "plugin",
    purpose: "",
    source,
    origin: "plugin",
    transport: "stdio",
    endpoint: "",
    args: [],
    env: {},
    headers: {},
    values: [],
    spec: null,
    auth: null,
    skills: [],
    servers: [],
    warnings: [],
    homepage: null,
  };
}

/* ── The registry ──────────────────────────────────────────────────────────── */

function view(pending: PendingDraft): ConnectorDraftView {
  const { draft } = pending;
  return {
    handle: pending.handle,
    kind: draft.kind,
    name: draft.name,
    slug: draft.slug,
    purpose: draft.purpose,
    source: draft.source,
    origin: draft.origin,
    transport: draft.transport,
    endpoint: draft.endpoint,
    values: draft.values.map(value => ({ key: value.key, label: value.label, hint: value.hint, required: value.required, secret: value.secret, preset: value.preset })),
    warnings: draft.warnings,
    homepage: draft.homepage,
    skills: draft.skills,
    servers: draft.servers.map(server => ({ name: server.name, transport: server.transport as AssistantTransport })),
    operations: pending.operations,
    version: pending.version,
    installable: pending.problem === null,
    problem: pending.problem,
  };
}

export function createConnectorSources(deps: ConnectorSourceDeps, fetchImpl: typeof fetch = fetch): ConnectorSources {
  const pending: PendingDraft[] = [];

  function forgetExpired(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (let index = pending.length - 1; index >= 0; index--) if (pending[index]!.createdAt < cutoff) pending.splice(index, 1);
  }

  function register(read: readonly ReadDraft[]): ImportResult {
    forgetExpired();
    const added: ConnectorDraftView[] = [];
    for (const item of read) {
      if (pending.length >= MAX_PENDING) break;
      const entry: PendingDraft = {
        handle: `draft-${randomBytes(8).toString("hex")}`,
        draft: item.draft,
        install: item.install,
        problem: item.problem,
        operations: item.operations,
        version: item.version,
        createdAt: Date.now(),
      };
      pending.push(entry);
      added.push(view(entry));
    }
    return { added, notes: [] };
  }

  async function collect(work: () => Promise<ReadDraft[]>): Promise<ImportResult> {
    try {
      const result = register(await work());
      if (result.added.length === 0) result.notes.push("Nothing new was found there.");
      return result;
    } catch (error) {
      return { added: [], notes: [error instanceof Error ? error.message : "That could not be read."] };
    }
  }

  async function fromFolder(path: string, source: string): Promise<ReadDraft[]> {
    const extension = await readExtensionFolder(path, source);
    if (extension !== null) {
      return [{ draft: extension.draft, install: { kind: "extension", slug: extension.draft.slug, from: "folder", path }, problem: null, operations: 0, version: extension.version }];
    }
    const pluginManifest = join(path, ".claude-plugin", "plugin.json");
    const marketplacePath = join(path, ".claude-plugin", "marketplace.json");
    if (await exists(marketplacePath)) {
      const marketplace = parseMarketplace(await readTextFile(marketplacePath));
      const local = marketplace.plugins.filter(plugin => plugin.localPath !== null);
      if (local.length === 0) throw new Error(`${marketplace.name} lists only plugins from other repositories, which ADCode does not clone.`);
      const out: ReadDraft[] = [];
      for (const plugin of local.slice(0, 20)) {
        const folder = join(path, ...plugin.localPath!.split("/"));
        if (!await exists(folder)) continue;
        const read = await readPluginFolder(folder, `Plugin: ${plugin.name}`);
        out.push({ draft: read.draft, install: { kind: "plugin", slug: read.draft.slug, from: "folder", path: folder }, problem: null, operations: 0, version: read.version });
      }
      if (out.length === 0) throw new Error(`${marketplace.name} lists plugins, but none of their folders are here.`);
      return out;
    }
    const pluginish = await exists(pluginManifest) || await exists(join(path, ".mcp.json")) || await exists(join(path, "skills"));
    if (pluginish) {
      const read = await readPluginFolder(path, source);
      return [{ draft: read.draft, install: { kind: "plugin", slug: read.draft.slug, from: "folder", path }, problem: null, operations: 0, version: read.version }];
    }
    throw new Error("That folder is not a Claude Desktop extension, a Claude Code plugin, or a marketplace. Pick the folder that holds the plugin's .claude-plugin folder, or the extension's manifest.json.");
  }

  async function fromArchive(load: () => Promise<Uint8Array>, source: string, name: string, attach: (kind: "extension" | "plugin", slug: string, bytes: Uint8Array) => PendingInstall): Promise<ReadDraft[]> {
    const bytes = await load();
    if (!isArchiveBytes(bytes)) throw new Error(`${name} is not a zip archive.`);
    const entries = readZipDirectory(bytes);
    const prefix = contentPrefix(entries);
    const extension = readExtensionArchive(bytes, entries, prefix, source);
    if (extension !== null) {
      return [{ draft: extension.draft, install: attach("extension", extension.draft.slug, bytes), problem: null, operations: 0, version: extension.version }];
    }
    const slug = slugify(basename(name).replace(/\.(mcpb|dxt|zip)$/i, ""), "plugin");
    const pluginish = entries.some(entry => entry.name === `${prefix}.claude-plugin/plugin.json`) || entries.some(entry => entry.name.startsWith(`${prefix}.mcp.json`)) || entries.some(entry => entry.name.startsWith(`${prefix}skills/`));
    if (pluginish) {
      const read = readPluginArchive(bytes, entries, prefix, source, slug);
      return [{ draft: read.draft, install: attach("plugin", read.draft.slug, bytes), problem: null, operations: 0, version: read.version }];
    }
    throw new Error(`${name} holds neither an extension's manifest.json nor a plugin's .claude-plugin folder.`);
  }

  async function fromPath(path: string): Promise<ImportResult> {
    return collect(async () => {
      const info = await stat(path);
      const name = basename(path);
      if (info.isDirectory()) return fromFolder(path, `Plugin folder: ${name}`);
      const lower = name.toLowerCase();
      if (lower.endsWith(".mcpb") || lower.endsWith(".dxt") || lower.endsWith(".zip")) {
        return fromArchive(() => readArchive(path), `Extension file: ${name}`, name, (kind, slug, bytes) => ({ kind, slug, from: "bytes", bytes }));
      }
      if (lower === "manifest.json") {
        const folder = dirname(path);
        const extension = await readExtensionFolder(folder, `Extension folder: ${basename(folder)}`);
        if (extension !== null) return [{ draft: extension.draft, install: { kind: "extension", slug: extension.draft.slug, from: "folder", path: folder }, problem: null, operations: 0, version: extension.version }];
      }
      const text = await readTextFile(path);
      return draftsFromText(text, { source: `Imported file: ${name}`, fileName: name, sourceUrl: null, fallbackName: slugify(name.replace(/\.json$/i, ""), "imported-server") }, fetchImpl);
    });
  }

  async function fromUrl(raw: string): Promise<ImportResult> {
    return collect(async () => {
      const url = fetchableUrl(raw);
      const response = await fetchCapped(url, MAX_ARCHIVE_BYTES, fetchImpl);
      const source = `Imported link: ${url.hostname}`;
      if (isArchiveBytes(response.bytes)) {
        const name = basename(url.pathname) || "download.mcpb";
        return fromArchive(async () => response.bytes, source, name, (kind, slug, bytes) => ({ kind, slug, from: "bytes", bytes }));
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(response.bytes);
      return draftsFromText(text, { source, fileName: basename(url.pathname) || null, sourceUrl: response.url, fallbackName: null }, fetchImpl);
    });
  }

  async function fromText(text: string, fileName: string | null): Promise<ImportResult> {
    return collect(async () => {
      if (text.length > MAX_TEXT_BYTES) throw new Error("That text is too large. Paste one document at a time.");
      return draftsFromText(text, { source: "Pasted text", fileName, sourceUrl: null, fallbackName: "imported-server" }, fetchImpl);
    });
  }

  async function scan(): Promise<ImportResult> {
    const workspace = deps.workspace();
    const configs: { readonly path: string; readonly source: string }[] = [
      { path: join(deps.appData, "Claude", "claude_desktop_config.json"), source: "Claude Desktop" },
      { path: join(deps.home, ".claude.json"), source: "Claude Code" },
      { path: join(deps.home, ".cursor", "mcp.json"), source: "Cursor" },
      { path: join(deps.home, ".codeium", "windsurf", "mcp_config.json"), source: "Windsurf" },
      { path: join(deps.appData, "Code", "User", "mcp.json"), source: "VS Code" },
      { path: join(deps.appData, "Cursor", "User", "mcp.json"), source: "Cursor" },
      ...(workspace === null ? [] : [
        { path: join(workspace, ".mcp.json"), source: "Claude Code: this project's .mcp.json" },
        { path: join(workspace, ".vscode", "mcp.json"), source: "VS Code: this project's mcp.json" },
      ]),
    ];

    const notes: string[] = [];
    const found: ReadDraft[] = [];
    for (const candidate of configs) {
      if (!await exists(candidate.path)) continue;
      try {
        const text = await readTextFile(candidate.path);
        const read = await draftsFromText(text, { source: candidate.source, fileName: basename(candidate.path), sourceUrl: null, fallbackName: null }, fetchImpl);
        found.push(...read);
      } catch (error) {
        notes.push(`${candidate.source}: ${error instanceof Error ? error.message : "could not be read."}`);
      }
    }

    const extensionsFolder = join(deps.appData, "Claude", "Extensions");
    for (const entry of (await listDirectory(extensionsFolder)).filter(item => item.directory).slice(0, 30)) {
      const folder = join(extensionsFolder, entry.name);
      try {
        const extension = await readExtensionFolder(folder, `Claude Desktop extension: ${entry.name}`);
        if (extension !== null && !found.some(item => item.draft.slug === extension.draft.slug)) {
          found.push({ draft: extension.draft, install: { kind: "extension", slug: extension.draft.slug, from: "folder", path: folder }, problem: null, operations: 0, version: extension.version });
        }
      } catch {
        // A folder that is not an extension is simply not offered.
      }
    }

    const result = register(found.slice(0, MAX_PENDING));
    result.notes.push(...notes);
    if (result.added.length === 0 && notes.length === 0) result.notes.push("No connectors were found in the usual places. Add one from a file, a link, or by hand.");
    return result;
  }

  return {
    scan,
    fromPath,
    fromUrl,
    fromText,
    views(): readonly ConnectorDraftView[] {
      forgetExpired();
      return pending.map(view);
    },
    take(handle: string): PendingDraft | null {
      forgetExpired();
      return pending.find(entry => entry.handle === handle) ?? null;
    },
    drop(handle: string): void {
      const index = pending.findIndex(entry => entry.handle === handle);
      if (index >= 0) pending.splice(index, 1);
    },
  };
}
