/**
 * Uploading a project into the web version's sandbox.
 *
 * The person picks a folder (or drops one, or a .zip). What goes up is the project, not its
 * rebuildable clutter: `node_modules`, `.git` and system files stay behind, and so does any path
 * that tries to climb out of the project. The sandbox side (`createProjectFolder`, `writeFile`
 * in `host/hostOps.ts`) checks the same thing again; the browser is never trusted with it.
 */

/** What one upload may weigh, after the clutter is left out. */
export const UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024;

const LEFT_BEHIND = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX"]);

export interface UploadEntry {
  /** The file's path as the browser gives it: `webkitRelativePath`, or the zip entry's name. */
  readonly path: string;
  readonly size: number;
}

export interface UploadPlan {
  /** Named after the picked folder, or "upload" for loose files. */
  readonly project: string;
  /** Paths inside the project, with each entry's index in the input. */
  readonly files: readonly { readonly path: string; readonly size: number; readonly index: number }[];
  readonly skipped: number;
  readonly totalBytes: number;
  readonly tooLarge: boolean;
}

export function planUpload(entries: readonly UploadEntry[]): UploadPlan {
  const split = entries.map((entry) => entry.path.replace(/\\/g, "/").split("/").filter((part) => part.length > 0 && part !== "."));
  const tops = new Set(split.map((parts) => (parts.length > 1 ? parts[0] : null)));
  const shared = tops.size === 1 && !tops.has(null) ? [...tops][0]! : null;

  const files: { path: string; size: number; index: number }[] = [];
  let skipped = 0;
  let totalBytes = 0;
  split.forEach((parts, index) => {
    const inside = shared === null ? parts : parts.slice(1);
    if (inside.length === 0 || inside.includes("..") || inside.some((part) => LEFT_BEHIND.has(part) || part.includes("\0"))) {
      skipped += 1;
      return;
    }
    const size = entries[index]!.size;
    totalBytes += size;
    files.push({ path: inside.join("/"), size, index });
  });

  return { project: shared ?? "upload", files, skipped, totalBytes, tooLarge: totalBytes > UPLOAD_LIMIT_BYTES };
}
