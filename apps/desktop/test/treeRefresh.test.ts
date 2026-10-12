import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
it("keeps a file name focused through watcher refreshes and submits the full name once", () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [resolve(import.meta.dirname, "fixtures/treeRefresh.cjs")], { env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const evidence = /^treeRefreshEvidence:(.+)$/m.exec(run.stdout);
  expect(evidence, run.stdout).not.toBeNull();
  expect(JSON.parse(evidence![1]!)).toEqual({ preserved: true, submittedOnce: true, retainedRow: true, staleRowRemoved: true, outsideEscape: true, innerEscape: true, modalEscape: true, modalFocusRestored: true });
}, 30_000);
