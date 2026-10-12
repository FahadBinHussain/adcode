import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("audits real accessibility, overflow and reduced-motion failures and verifies the repaired page", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/pageAudit.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("PAGE_AUDIT_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(JSON.parse(line!.slice("PAGE_AUDIT_RESULTS=".length))).toEqual({ realAxe: true, responsive: true, reducedMotion: true, mediaReset: true, cancelled: true });
}, 45_000);
