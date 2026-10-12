/** Discover and run the project's own checks, inside the caller's resolved workspace. */
import { readFile, stat } from "node:fs/promises";
import { resolveSandboxPath } from "./aiSandbox.ts";
import { clipOutput, type CommandRunner } from "./aiCommands.ts";
import type { ToolRunResult } from "@adcode/ai";

const CONFIGS = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "tsconfig.json", "vite.config.ts", "next.config.ts", "next.config.js", "astro.config.mjs", "components.json", "playwright.config.ts", "vitest.config.ts", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "README.md", "AGENTS.md"];
const CHECKS = {
  types: ["typecheck", "type-check", "check:types"],
  lint: ["lint:ci", "lint", "check:lint"],
  tests: ["test:ci", "test:run", "test"],
  build: ["build"],
} as const;
type Manager = "npm" | "pnpm" | "yarn" | "bun";
interface ProjectChecks {
  manager: Manager | null;
  managerNote: string;
  scripts: Record<string, string>;
  configs: string[];
  dependencies: string[];
}

async function discover(directory: string): Promise<ProjectChecks> {
  const configs: string[] = [];
  for (const file of CONFIGS) {
    const path = await resolveSandboxPath(directory, file);
    if (await stat(path).then(info => info.isFile(), () => false)) configs.push(file);
  }
  let manifest: Record<string, unknown> = {};
  if (configs.includes("package.json")) {
    const path = await resolveSandboxPath(directory, "package.json");
    if ((await stat(path)).size > 256_000) throw new Error("package.json is too large to inspect (limit 256 KB).");
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("package.json must contain an object.");
    manifest = parsed as Record<string, unknown>;
  }
  const scripts: Record<string, string> = Object.create(null) as Record<string, string>;
  const raw = manifest["scripts"];
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [name, command] of Object.entries(raw)) if (typeof command === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,80}$/.test(name)) scripts[name] = command;
  }
  const declared = typeof manifest["packageManager"] === "string" ? /^(npm|pnpm|yarn|bun)@/.exec(manifest["packageManager"])?.[1] as Manager | undefined : undefined;
  const locks: Manager[] = [];
  if (configs.includes("package-lock.json")) locks.push("npm");
  if (configs.includes("pnpm-lock.yaml")) locks.push("pnpm");
  if (configs.includes("yarn.lock")) locks.push("yarn");
  if (configs.includes("bun.lock") || configs.includes("bun.lockb")) locks.push("bun");
  const unsupported = typeof manifest["packageManager"] === "string" && declared === undefined;
  const manager = unsupported ? null : declared ?? (locks.length > 1 ? null : locks[0] ?? "npm");
  const dependencies = ["dependencies", "devDependencies"].flatMap(key => {
    const value = manifest[key];
    return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  });
  return { manager, managerNote: unsupported ? "Unsupported packageManager field; use the project's native commands." : declared ? "packageManager field" : locks.length > 1 ? "Conflicting lockfiles; choose the package manager before running checks." : locks.length === 1 ? "lockfile" : "npm fallback; no package manager declared", scripts, configs, dependencies: [...new Set(dependencies)].sort() };
}

function selectedChecks(project: ProjectChecks): { selected: string[]; missing: string[] } {
  const selected: string[] = [];
  const missing: string[] = [];
  for (const [kind, names] of Object.entries(CHECKS)) {
    const name = names.find(one => project.scripts[one] !== undefined);
    if (name) selected.push(name); else missing.push(kind);
  }
  return { selected, missing };
}

export async function inspectProject(directory: string): Promise<ToolRunResult> {
  const project = await discover(directory);
  const { selected, missing } = selectedChecks(project);
  return { isError: false, content: [
    "Project inspection (nothing executed)",
    `Files found: ${project.configs.join(", ") || "none of the supported manifests/configs"}`,
    `Package manager: ${project.manager ?? "unresolved"} (${project.managerNote})`,
    `Dependencies: ${project.dependencies.slice(0, 100).join(", ") || "none declared in package.json"}${project.dependencies.length > 100 ? " (first 100)" : ""}`,
    `Available scripts:\n${Object.entries(project.scripts).slice(0, 60).map(([name, command]) => `- ${name}: ${command.slice(0, 300)}`).join("\n") || "- None. For a non-JavaScript project, read its manifest and use run_command for its native checks."}`,
    `Suggested checks: ${selected.join(", ") || "none"}. Missing check categories: ${missing.join(", ") || "none"}.`,
    "Read project instructions and the scripts before executing them. A missing check is unverified, never a pass. Use run_project_checks for these scripts; use view_page/audit_page for the running UI and its key flows.",
  ].join("\n\n") };
}

export async function runProjectChecks(directory: string, input: Record<string, unknown>, commands: CommandRunner, signal: AbortSignal): Promise<ToolRunResult> {
  const project = await discover(directory);
  if (project.manager === null) return { isError: true, content: project.managerNote };
  const discovered = selectedChecks(project);
  const supplied = input["scripts"];
  if (supplied !== undefined && (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 4 || !supplied.every(name => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,80}$/.test(name)))) {
    return { isError: true, content: "scripts must contain 1–4 script names from package.json. Shell commands are not accepted here." };
  }
  const scripts = [...new Set(supplied === undefined ? discovered.selected : supplied as string[])];
  const unknown = scripts.filter(name => project.scripts[name] === undefined);
  if (unknown.length > 0) return { isError: true, content: `Unknown scripts: ${unknown.join(", ")}. Call inspect_project to see available scripts. Nothing ran.` };
  if (scripts.length === 0) return { isError: true, content: "No project checks are configured. Read the project manifest and use run_command for its native checks. Nothing ran; release readiness is unverified." };
  const seconds = input["timeout_seconds"] ?? 120;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) return { isError: true, content: "timeout_seconds must be 1–600; it is the total budget shared by all checks." };
  const deadline = Date.now() + seconds * 1000;
  const lines: string[] = [];
  let failed = false;
  let passed = 0;
  for (const name of scripts) {
    const remaining = deadline - Date.now();
    if (signal.aborted || remaining <= 0) {
      failed = true;
      lines.push(`${name}: NOT RUN (${signal.aborted ? "cancelled" : "total time budget exhausted"})`);
      continue;
    }
    const outcome = await commands.runForeground(`${project.manager} run ${name}`, directory, remaining, signal);
    const success = outcome.exitCode === 0 && !outcome.timedOut && !outcome.cancelled;
    if (success) passed++; else failed = true;
    lines.push(`${name}: ${success ? "PASS" : outcome.cancelled ? "CANCELLED" : outcome.timedOut ? "TIMEOUT" : "FAIL"} (exit ${outcome.exitCode ?? "unknown"})\n${clipOutput(outcome.output.trim() || "(no output)", 4500)}`);
  }
  return { isError: failed, content: [
    `Project checks: ${passed}/${scripts.length} passed. Package manager: ${project.manager}.`,
    ...lines,
    `Unconfigured standard checks: ${discovered.missing.join(", ") || "none"}. Only the named scripts above were run.`,
    "This checks code, not full production readiness. Verify critical user flows, mobile layouts, accessibility, configuration and deployment separately. Fix failures before claiming completion.",
  ].join("\n\n") };
}
