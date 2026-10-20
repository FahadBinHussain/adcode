import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IndexHtmlTransformContext, Plugin, UserConfigFnObject } from "vite";
import webConfig from "../vite.web.config.ts";
import { WEB_APP_SCHEMA } from "../src/web/seo.ts";
import { WEB_APP_SCHEMA_CSP } from "../../cloud/src/seo.ts";

async function launchHtml(): Promise<string> {
  const config = (webConfig as UserConfigFnObject)({ mode: "production", command: "build" });
  const plugin = config.plugins?.find((candidate) => candidate !== null && typeof candidate === "object" && "name" in candidate && candidate.name === "adcode-web-entry") as Plugin;
  const hook = plugin.transformIndexHtml;
  if (hook === undefined || typeof hook === "function") throw new Error("Web entry transform missing");
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const transform = hook.handler as (html: string, context: IndexHtmlTransformContext) => unknown;
  const result = await transform(html, {} as IndexHtmlTransformContext);
  if (typeof result !== "string") throw new Error("Expected the browser HTML");
  return result;
}

describe("browser launch HTML", () => {
  it("ships the paused notice before any JavaScript runs", async () => {
    const html = await launchHtml();
    expect(html).toContain("<h1>The web version is paused</h1>");
    expect(html).toContain("We're not ready for a web release yet.");
    expect(html).toContain('href="https://adcode.bluethenics.com/#download"');
    expect(html).toContain('href="https://adcode.bluethenics.com"');
    expect(html).not.toContain('<script type="module"');
    expect(html).not.toContain('id="workbench"');
  });

  it("keeps the paused page out of search and shares the pause", async () => {
    const html = await launchHtml();
    expect(html).toContain("<title>ADCode Web is paused — try the desktop app</title>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain("data-adcode-public-launch");
    expect(html).toContain('<meta name="description" content="The ADCode web version is paused while we get it ready.');
    expect(html).toContain('<meta property="og:url" content="https://web.bluethenics.com/" />');
    expect(html).not.toContain('id="adcode-web-app-schema"');
  });

  it("allows exactly the published structured data under the app's strict CSP", () => {
    const digest = createHash("sha256").update(WEB_APP_SCHEMA).digest("base64");
    expect(WEB_APP_SCHEMA_CSP).toBe(`'sha256-${digest}'`);
  });

  it("retains useful public copy and the guide link after the real signed-out gate replaces the splash", () => {
    const require = createRequire(import.meta.url);
    const env = { ...process.env };
    delete env["ELECTRON_RUN_AS_NODE"];
    const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/webLaunch.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30000, windowsHide: true });
    expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
    const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("WEB_LAUNCH_RESULTS="));
    expect(line, run.stdout).toBeDefined();
    const results = JSON.parse(line!.slice("WEB_LAUNCH_RESULTS=".length)) as Record<string, boolean>;
    expect(Object.keys(results)).toHaveLength(9);
    expect(Object.values(results).every(Boolean)).toBe(true);
  }, 35000);
});
