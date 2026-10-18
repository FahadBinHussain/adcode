/**
 * Putting an extension or plugin's files where ADCode keeps them.
 *
 * Two shapes arrive: a `.mcpb`/`.zip` archive, and a folder that is already unpacked
 * (Claude Desktop's own `Extensions` directory, or a plugin checkout). Both are installed
 * into `~/.adcode/extensions/<slug>` or `~/.adcode/plugins/<slug>` - the app's own
 * folder, so nothing here ever writes into the tool it was imported from.
 *
 * Everything is installed into a staging folder beside its destination and moved into
 * place with one rename, so a failure halfway through leaves nothing half-installed. That
 * rename can only work when the staging folder is on the same volume, which is why the
 * staging folder is created under the destination's own root.
 *
 * The caps are deliberately bigger than the zip reader's: an extension that bundles
 * `node_modules` inflates to more than its download size, and refusing the *install* by
 * the reader's download caps would reject perfectly ordinary extensions. The entry-name
 * checks in the zip reader still apply to every file written here.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { readZipDirectory, readZipEntry, type ZipEntry } from "@adcode/connect";

export interface InstallLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const INSTALL_LIMITS: InstallLimits = { maxFiles: 20_000, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };

/** Where installed extensions live. */
export const extensionRoot = (home: string): string => join(home, ".adcode", "extensions");
/** Where installed plugins live. */
export const pluginRoot = (home: string): string => join(home, ".adcode", "plugins");

const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024).toLocaleString()} MB`;

/**
 * The folder inside an archive that holds its content.
 *
 * Archives are made by tools that either zip a folder (everything under one top-level
 * name) or zip its contents (files at the root). Both are ordinary; a leading folder
 * name is stripped so the install folder is the extension itself, not a wrapper.
 */
export function contentPrefix(entries: readonly ZipEntry[]): string {
  if (entries.length === 0) return "";
  const tops = new Set(entries.map(entry => entry.name.split("/")[0]!));
  if (tops.size !== 1) return "";
  const [top] = [...tops];
  return entries.some(entry => entry.name === top) ? "" : `${top!}/`;
}

/** The first free `<root>/<slug>`, `<root>/<slug>-2`, … so reinstalling never overwrites. */
async function freeDestination(root: string, slug: string): Promise<string> {
  await mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = join(root, attempt === 0 ? slug : `${slug}-${(attempt + 1).toString()}`);
    try {
      await readdir(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`There are already too many folders named ${slug} in ${root}.`);
}

interface Staging {
  readonly work: string;
  readonly destination: string;
}
async function stage(root: string, slug: string): Promise<Staging> {
  const destination = await freeDestination(root, slug);
  const work = `${destination}.staging-${randomBytes(4).toString("hex")}`;
  await mkdir(work, { recursive: true });
  return { work, destination };
}
async function commit(staging: Staging): Promise<string> {
  await rename(staging.work, staging.destination);
  return staging.destination;
}

/** Every entry the archive holds, inflated, validated and written under the staging folder. */
async function writeArchive(bytes: Uint8Array, staging: Staging, limits: InstallLimits): Promise<void> {
  const entries = readZipDirectory(bytes);
  const prefix = contentPrefix(entries);
  const files = entries.filter(entry => !entry.directory && entry.name.startsWith(prefix) && entry.name !== prefix);
  if (files.length === 0) throw new Error("The archive holds no files.");
  if (files.length > limits.maxFiles) throw new Error(`The archive holds more than ${limits.maxFiles.toLocaleString()} files.`);
  let total = 0;
  for (const entry of files) {
    if (entry.size > limits.maxFileBytes) throw new Error(`${entry.name} is larger than ${mb(limits.maxFileBytes)}.`);
    total += entry.size;
    if (total > limits.maxTotalBytes) throw new Error(`The archive unpacks to more than ${mb(limits.maxTotalBytes)}.`);
    const target = join(staging.work, ...entry.name.slice(prefix.length).split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, readZipEntry(bytes, entry));
  }
}

/** Copy a folder tree, refusing links and staying inside the given caps. */
async function copyTree(source: string, target: string, limits: InstallLimits, budget: { files: number; bytes: number }, skipped: string[]): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".DS_Store") continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      skipped.push(entry.name);
      continue;
    }
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await copyTree(from, to, limits, budget, skipped);
      continue;
    }
    if (!entry.isFile()) continue;
    budget.files += 1;
    if (budget.files > limits.maxFiles) throw new Error(`This folder holds more than ${limits.maxFiles.toLocaleString()} files.`);
    const data = await readFile(from);
    budget.bytes += data.byteLength;
    if (data.byteLength > limits.maxFileBytes) throw new Error(`${entry.name} is larger than ${mb(limits.maxFileBytes)}.`);
    if (budget.bytes > limits.maxTotalBytes) throw new Error(`This folder is larger than ${mb(limits.maxTotalBytes)}.`);
    await writeFile(to, data);
  }
}

export interface InstalledFolder {
  readonly directory: string;
  /** Names of files that were links and therefore not installed. */
  readonly skipped: readonly string[];
}

/** Unpack a `.mcpb` / `.zip` archive into `<root>/<slug>`. */
export async function installArchive(bytes: Uint8Array, root: string, slug: string, limits: InstallLimits = INSTALL_LIMITS): Promise<InstalledFolder> {
  const staging = await stage(root, slug);
  try {
    await writeArchive(bytes, staging, limits);
  } catch (error) {
    await rm(staging.work, { recursive: true, force: true });
    throw error;
  }
  return { directory: await commit(staging), skipped: [] };
}

/** Copy an unpacked extension or plugin folder into `<root>/<slug>`. */
export async function installFolder(source: string, root: string, slug: string, limits: InstallLimits = INSTALL_LIMITS): Promise<InstalledFolder> {
  const staging = await stage(root, slug);
  const skipped: string[] = [];
  try {
    await copyTree(source, staging.work, limits, { files: 0, bytes: 0 }, skipped);
  } catch (error) {
    await rm(staging.work, { recursive: true, force: true });
    throw error;
  }
  return { directory: await commit(staging), skipped };
}

/** Remove an installed folder. Only paths under `root` are touched. */
export async function removeInstalled(directory: string, root: string): Promise<void> {
  const normalRoot = root.endsWith("/") || root.endsWith("\\") ? root : `${root}/`;
  const normalized = directory.replaceAll("\\", "/");
  const normalizedRoot = normalRoot.replaceAll("\\", "/");
  if (!normalized.startsWith(normalizedRoot) || normalized.length <= normalizedRoot.length) throw new Error("Refusing to remove a folder outside the ADCode install directory.");
  await rm(directory, { recursive: true, force: true });
}
