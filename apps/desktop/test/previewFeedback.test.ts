import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("explains empty and failed previews, opens working previews, and renders Lucide SVGs", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/previewFeedback.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("PREVIEW_FEEDBACK_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(JSON.parse(line!.slice("PREVIEW_FEEDBACK_RESULTS=".length))).toEqual({
    empty: true, visibleFeedback: true, startError: true, connectionError: true,
    detectError: true, idle: true, success: true, close: true, lucide: true,
  });
}, 35_000);
