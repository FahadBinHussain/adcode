/**
 * Operations only the web version needs, answered by adcode-host.
 *
 * They are not IPC channels on purpose: the desktop preload and the web bridge forward exactly
 * the same channels (`test/webBridgeTable.test.ts`), and these have no desktop meaning. A tab
 * asks for one by name in an `op` frame; any name not listed here is refused.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** "My Site!" -> "my-site": a folder name that is safe everywhere, or "project". */
function folderName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return cleaned.length === 0 ? "project" : cleaned;
}

/** True when `inner` is `outer` itself or somewhere beneath it. */
function within(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** "https://github.com/someone/My-App.git" -> "my-app". */
export function repoFolderName(url: string): string {
  const last = url.replace(/\/+$/, "").split("/").pop() ?? "";
  return folderName(last.replace(/\.git$/i, ""));
}

/**
 * Only plain https addresses. Git's other transports are not just other ways to fetch: `ext::`
 * runs a command, `file://` reads the sandbox's own disk, and an argument starting with `-` is
 * an option. A clone address from a text box must be none of those.
 */
function httpsRepository(url: unknown): URL {
  if (typeof url !== "string" || url.startsWith("-")) throw new Error("Use the repository's https address, like https://github.com/you/project");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Use the repository's https address, like https://github.com/you/project");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.length === 0 || parsed.pathname.length <= 1) {
    throw new Error("Use the repository's https address, like https://github.com/you/project");
  }
  return parsed;
}

function run(command: string, args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: -1, output: error.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

export interface HostOpsOptions {
  readonly projectsHome: string;
}

export interface ProjectSummary {
  readonly name: string;
  readonly path: string;
  readonly modifiedAt: number;
}

export function createHostOps(options: HostOpsOptions): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return {
    /** The folders under the projects home, most recently changed first. */
    async projects(): Promise<ProjectSummary[]> {
      let entries;
      try {
        entries = await readdir(options.projectsHome, { withFileTypes: true });
      } catch {
        return [];
      }
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map(async (entry) => {
            const path = join(options.projectsHome, entry.name);
            const info = await stat(path).catch(() => null);
            return { name: entry.name, path, modifiedAt: info?.mtimeMs ?? 0 };
          }),
      );
      return projects.sort((a, b) => b.modifiedAt - a.modifiedAt);
    },

    /** A new, empty project folder for an upload, named like it; `-2`, `-3`... when taken. */
    async createProjectFolder(name: unknown): Promise<string> {
      const base = folderName(typeof name === "string" ? name : "");
      await mkdir(options.projectsHome, { recursive: true });
      for (let attempt = 1; attempt < 1000; attempt += 1) {
        const candidate = join(options.projectsHome, attempt === 1 ? base : `${base}-${attempt}`);
        if (!(await exists(candidate))) {
          await mkdir(candidate);
          return candidate;
        }
      }
      throw new Error("Too many projects with that name");
    },

    /** Clones a public (or, once GitHub is connected, private) repository into a new project. */
    async cloneProject(url: unknown): Promise<string> {
      const repository = httpsRepository(url);
      await mkdir(options.projectsHome, { recursive: true });
      const target = (await this["createProjectFolder"]!(repoFolderName(repository.href))) as string;
      await rm(target, { recursive: true, force: true });
      const result = await run("git", ["clone", "--", repository.href, target], options.projectsHome);
      if (result.code !== 0) {
        await rm(target, { recursive: true, force: true });
        const reason = /could not read Username|Authentication failed|not found/i.test(result.output)
          ? "That repository is private or doesn't exist. Check the address, or connect GitHub first."
          : `Git couldn't clone it: ${result.output.trim().split("\n").at(-1) ?? "unknown error"}`;
        throw new Error(reason);
      }
      return target;
    },

    /**
     * One uploaded file, written inside a project. The path is the file's place in the folder
     * the person picked, and it may not climb out of the project, which may not be outside the
     * projects home: an upload never writes anywhere else in the sandbox.
     */
    async writeFile(root: unknown, path: unknown, bytes: unknown): Promise<number> {
      if (typeof root !== "string" || typeof path !== "string" || !(bytes instanceof Uint8Array)) throw new Error("Expected a project, a path and bytes");
      if (path.length === 0 || path.includes("\0") || isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.split(/[\\/]/).includes("..")) {
        throw new Error("That path is not inside the project");
      }
      const projectRoot = resolve(root);
      if (!within(resolve(options.projectsHome), projectRoot) || projectRoot === resolve(options.projectsHome)) throw new Error("That project is not in your workspace");
      const target = resolve(projectRoot, path.split(/[\\/]/).join(sep));
      if (!within(projectRoot, target) || target === projectRoot) throw new Error("That path is not inside the project");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return bytes.length;
    },
  };
}
