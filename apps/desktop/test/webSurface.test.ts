/*
 * Which surface the renderer is running on, and the build that decides it.
 *
 * The same renderer ships in the desktop app and at web.bluethenics.com. The handful of places
 * that differ (no "Open IDE", no local models) ask `isWebSurface()`. The web build's one
 * dangerous switch is the development sign-in bypass: it must exist only when Vite runs in
 * development mode, never in a production build.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isWebSurface } from "../src/renderer/surface.ts";
import webConfig from "../vite.web.config.ts";

const original = (globalThis as { document?: unknown }).document;

afterEach(() => {
  if (original === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document?: unknown }).document = original;
});

function withSurface(surface: string | undefined): void {
  (globalThis as { document?: unknown }).document = { documentElement: { dataset: surface === undefined ? {} : { surface } } };
}

describe("surface", () => {
  it("is the desktop when there is no document", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(isWebSurface()).toBe(false);
  });

  it("is the desktop unless the page says web", () => {
    withSurface(undefined);
    expect(isWebSurface()).toBe(false);
    withSurface("web");
    expect(isWebSurface()).toBe(true);
  });
});

describe("web build", () => {
  type ConfigFn = (env: { mode: string; command: "build" | "serve"; isSsrBuild?: boolean; isPreview?: boolean }) => { define?: Record<string, string> };

  it("turns the development sign-in off in production", () => {
    const config = (webConfig as unknown as ConfigFn)({ mode: "production", command: "build" });
    expect(config.define?.["__ADCODE_WEB_DEV__"]).toBe("false");
  });

  it("turns it on only in development", () => {
    const config = (webConfig as unknown as ConfigFn)({ mode: "development", command: "serve" });
    expect(config.define?.["__ADCODE_WEB_DEV__"]).toBe("true");
  });
});
