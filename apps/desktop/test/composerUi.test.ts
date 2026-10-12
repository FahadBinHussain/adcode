import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps real context, allowance, send and shortcut controls usable across composer sizes", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/composerUi.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("COMPOSER_UI_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(JSON.parse(line!.slice("COMPOSER_UI_RESULTS=".length)),run.stdout).toEqual({
    realValues: true, visibleRings: true, accessible: true, contextActions: true, contextFocus: true,
    usageDetails: true, shortcuts: true, fileShortcut: true, liveContext: true, liveAllowance: true,
    failedRead: true, recovers: true, externalNoQuota: true, sendPreserved: true, stopPreserved: true,
    failedPlanSettles: true, includedRecovery: true, dailyUsageAction: true, cancelledPlanSettles: true, unfinishedPlanHonest: true,
    providerRace: true, usageCleanup: true, layouts: true, noErrors: true,
    automaticWaitVisible:true,switchingWaitingTask:true,stopCancelsWait:true,workspaceCancelsWait:true,
  });
}, 35_000);
