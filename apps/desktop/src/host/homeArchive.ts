/**
 * The sandbox home as one stream, and a project as a download.
 *
 * A container's disk is wiped when it sleeps, and Cloudflare's own container snapshots are
 * tied to the exact image they came from, so every adcode-host update would strand everyone's
 * work. Instead the cloud asks for `/home/adcode` as a gzipped tar when the sandbox goes to
 * sleep, stores it in R2, and streams it back into whatever image is current on the next wake.
 *
 * `tar` is the system's: GNU tar in the container, bsdtar on a Windows development machine.
 * Both read the flags used here.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

/** Caches that rebuild on their own and only make the archive slower. */
const HOME_EXCLUDES = ["./.cache", "./.npm", "./.adcode/logs", "./.adcode/trash"];

function pipeTar(args: readonly string[], cwd: string, response: ServerResponse, contentType: string, filename?: string): void {
  const child = spawn("tar", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  response.writeHead(200, {
    "content-type": contentType,
    ...(filename === undefined ? {} : { "content-disposition": `attachment; filename="${filename}"` }),
  });
  child.stdout.pipe(response);
  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`[adcode-host] tar exited ${code}: ${stderr.slice(0, 500)}`);
      response.destroy(new Error("archive failed"));
    }
  });
  response.on("close", () => {
    if (child.exitCode === null) child.kill();
  });
}

export function streamHomeArchive(home: string, response: ServerResponse): void {
  const excludes = HOME_EXCLUDES.flatMap((path) => ["--exclude", path]);
  pipeTar(["-czf", "-", ...excludes, "."], home, response, "application/gzip");
}

export function restoreHomeArchive(home: string, request: IncomingMessage, response: ServerResponse): void {
  const child = spawn("tar", ["-xzf", "-"], { cwd: home, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  request.pipe(child.stdin);
  child.on("close", (code) => {
    if (code === 0) {
      response.writeHead(204).end();
    } else {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: stderr.slice(0, 500) }));
    }
  });
}

/** A project name is one folder under the projects home: no separators, no parent references. */
export function safeProjectName(name: string | null, projectsHome: string): string | null {
  if (name === null || name.length === 0 || name.length > 200) return null;
  if (/[/\\\0]/.test(name) || name === "." || name === "..") return null;
  const path = join(projectsHome, name);
  try {
    return existsSync(path) && statSync(path).isDirectory() ? name : null;
  } catch {
    return null;
  }
}

export function streamProjectDownload(projectsHome: string, name: string, response: ServerResponse): void {
  const ascii = name.replace(/[^\w.-]+/g, "-");
  pipeTar(["-czf", "-", "--exclude", "node_modules", "--exclude", ".git", name], projectsHome, response, "application/gzip", `${ascii}.tar.gz`);
}
