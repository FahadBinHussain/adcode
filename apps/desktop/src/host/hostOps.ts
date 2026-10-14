/**
 * Operations only the web version needs, answered by adcode-host.
 *
 * They are not IPC channels on purpose: the desktop preload and the web bridge forward exactly
 * the same channels (`test/webBridgeTable.test.ts`), and these have no desktop meaning. A tab
 * asks for one by name in an `op` frame; any name not listed here is refused.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

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
  };
}
