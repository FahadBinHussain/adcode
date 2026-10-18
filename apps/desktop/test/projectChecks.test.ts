import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { inspectProject, runProjectChecks } from "../src/main/projectChecks.ts";
import { createCommandRunner } from "../src/main/aiCommands.ts";
import { createAiToolRunner } from "../src/main/aiTools.ts";
import { parseAuditPageInput } from "../src/main/agentBrowserModel.ts";
import { createFileChange } from "@adcode/ai";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "adcode-project-checks-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const manifest = (value: object) => writeFile(join(root, "package.json"), JSON.stringify(value));
const signal = () => new AbortController().signal;

describe("project check discovery and execution", () => {
  it("discovers the declared manager, stack and preferred CI scripts without executing", async () => {
    await manifest({ packageManager: "pnpm@10.0.0", dependencies: { react: "1" }, scripts: { test: "watch", "test:ci": "vitest run", typecheck: "tsc --noEmit", build: "vite build" } });
    const result = await inspectProject(root);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("pnpm (packageManager field)");
    expect(result.content).toContain("react");
    expect(result.content).toContain("Suggested checks: typecheck, test:ci, build");
    expect(result.content).toContain("Missing check categories: lint");
  });

  it("refuses conflicting or unsupported package managers before running", async () => {
    await manifest({ scripts: { build: "noop" } });
    await writeFile(join(root, "yarn.lock"), "");
    await writeFile(join(root, "pnpm-lock.yaml"), "");
    const commands = createCommandRunner();
    const run = vi.spyOn(commands, "runForeground");
    expect((await runProjectChecks(root, {}, commands, signal())).content).toContain("Conflicting lockfiles");
    await manifest({ packageManager: "unknown@1", scripts: { build: "noop" } });
    expect((await runProjectChecks(root, {}, commands, signal())).content).toContain("Unsupported packageManager");
    expect(run).not.toHaveBeenCalled();
  });

  it("executes real project scripts and reports a failure without claiming readiness", async () => {
    await manifest({ scripts: { typecheck: 'node -e "console.log(\'types checked\')"', build: 'node -e "console.error(\'compile broke\');process.exit(2)"' } });
    const result = await runProjectChecks(root, {}, createCommandRunner(), signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("1/2 passed");
    expect(result.content).toContain("typecheck: PASS (exit 0)");
    expect(result.content).toContain("build: FAIL (exit 2)");
    expect(result.content).toContain("compile broke");
    expect(result.content).toContain("Unconfigured standard checks: lint, tests");
  }, 15_000);

  it("validates the entire requested batch and rejects shell injection and inherited names", async () => {
    await manifest({ scripts: { build: "noop" } });
    const commands = createCommandRunner();
    const run = vi.spyOn(commands, "runForeground");
    for (const scripts of [["build", "missing"], ["build && echo injected"], ["toString"], ["constructor"], []]) {
      expect((await runProjectChecks(root, { scripts }, commands, signal())).isError).toBe(true);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("marks cancelled and remaining checks unverified and shares one time budget", async () => {
    await manifest({ scripts: { lint: "noop", build: "noop" } });
    const controller = new AbortController();
    const commands = createCommandRunner();
    const run = vi.spyOn(commands, "runForeground").mockImplementation(async (_command, _directory, timeout, passedSignal) => {
      expect(timeout).toBeLessThanOrEqual(2000);
      expect(passedSignal).toBe(controller.signal);
      controller.abort();
      return { output: "", exitCode: null, timedOut: false, cancelled: true };
    });
    const result = await runProjectChecks(root, { timeout_seconds: 2 }, commands, controller.signal);
    expect(run).toHaveBeenCalledOnce();
    expect(result.content).toContain("lint: CANCELLED");
    expect(result.content).toContain("build: NOT RUN (cancelled)");
    expect(result.isError).toBe(true);
  });

  it("does not call a project without checks a pass, and handles malformed manifests", async () => {
    const result = await runProjectChecks(root, {}, createCommandRunner(), signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("unverified");
    await writeFile(join(root, "package.json"), "{bad json");
    await expect(inspectProject(root)).rejects.toThrow();
  });
});

describe("the quality tool runner", () => {
  function runner() {
    const writes = vi.fn(async () => ({ taskId: "review", sandboxRoot: root, humanRoot: root }));
    const view = vi.fn(async () => ({ content: "Accessibility: 0 rule violations", isError: false }));
    return { writes, view, tools: createAiToolRunner({ workspace: async () => ({ taskId: "", sandboxRoot: root, humanRoot: root }), writeWorkspace: writes, viewPage: view, memory: () => null, onProposedEdit: () => {}, writeSandboxFile: async (path, text) => createFileChange(path, null, text) }) };
  }
  it("keeps inspection read-only and confines subproject paths", async () => {
    await mkdir(join(root, "app"));
    await writeFile(join(root, "app", "package.json"), JSON.stringify({ scripts: { build: "noop" } }));
    const { tools, writes } = runner();
    const read = await tools.run({ type: "tool-call", id: "1", name: "inspect_project", input: { cwd: "app" } }, signal());
    expect(read.content).toContain("build: noop");
    expect(writes).not.toHaveBeenCalled();
    const escaped = await tools.run({ type: "tool-call", id: "2", name: "run_project_checks", input: { cwd: "../outside" } }, signal());
    expect(escaped.isError).toBe(true);
    expect(escaped.content).toContain("workspace-relative");
  });
  it("audits every requested size and validates all sizes before opening a page", async () => {
    const { tools, view } = runner();
    const audited = await tools.run({ type: "tool-call", id: "1", name: "audit_page", input: { url: "http://localhost:5173/settings" } }, signal());
    expect(audited.isError).toBe(false);
    expect(view.mock.calls).toHaveLength(3);
    view.mockClear();
    const invalid = await tools.run({ type: "tool-call", id: "2", name: "audit_page", input: { viewports: [{ width: 390, height: 844 }, { width: 1, height: 2 }] } }, signal());
    expect(invalid.isError).toBe(true);
    expect(view).not.toHaveBeenCalled();
  });
  it("uses reduced motion and no screenshots by default, and permits public pages but rejects private addresses", () => {
    const parsed = parseAuditPageInput({ path: "/settings" });
    expect(parsed).toMatchObject([{ reducedMotion: true, audit: true, screenshot: false, target: { kind: "preview", path: "/settings" } }, {}, {}]);
    expect(parseAuditPageInput({ url: "https://example.com" })).toMatchObject([{ target: { kind: "url" } }, {}, {}]);
    expect(parseAuditPageInput({ url: "http://192.168.1.1" })).toContain("public HTTP");
    expect(parseAuditPageInput({ reduced_motion: "false" })).toContain("true or false");
  });
});
