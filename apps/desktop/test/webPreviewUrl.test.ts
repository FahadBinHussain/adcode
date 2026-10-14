/*
 * Preview addresses on the web.
 *
 * In the sandbox a dev server says `http://localhost:5173`. The person's browser needs the
 * preview's public address instead, and needs its private cookie before the first load - which
 * the cloud hands out against a one-time code. The Preview pane only ever sees the clean public
 * address; the code is spent once, in the background, and remembered for as long as the cookie
 * lasts.
 */
import { describe, expect, it } from "vitest";
import { createPreviewResolver, rewriteStatus } from "../src/web/previewUrl.ts";

const AUTH = (nonce: string, next: string) => `https://p-5173-abcdefghij.web.bluethenics.com/__adcode/auth?t=${nonce}&next=${encodeURIComponent(next)}`;

function harness() {
  const asked: string[] = [];
  const primed: string[] = [];
  let nonce = 0;
  const resolve = createPreviewResolver(
    { previewUrl: async (url) => { asked.push(url); nonce += 1; return AUTH(`n${nonce}`, new URL(url).pathname + new URL(url).search); } },
    async (url) => { primed.push(url); },
    () => 1_000,
  );
  return { resolve, asked, primed };
}

describe("preview resolver", () => {
  it("gives the pane the clean public address, after spending the code in the background", async () => {
    const { resolve, primed } = harness();
    expect(await resolve("http://localhost:5173/menu?x=1")).toBe("https://p-5173-abcdefghij.web.bluethenics.com/menu?x=1");
    expect(primed).toEqual([AUTH("n1", "/menu?x=1")]);
  });

  it("asks the cloud once per preview while the cookie lasts", async () => {
    const { resolve, asked } = harness();
    await resolve("http://localhost:5173/");
    expect(await resolve("http://localhost:5173/about")).toBe("https://p-5173-abcdefghij.web.bluethenics.com/about");
    expect(asked).toEqual(["http://localhost:5173/"]);
  });

  it("leaves an address alone when there is no cloud in front (local development)", async () => {
    const resolve = createPreviewResolver({ previewUrl: async (url) => url }, async () => undefined, () => 0);
    expect(await resolve("http://localhost:5173/")).toBe("http://localhost:5173/");
  });

  it("leaves anything that is not a sandbox address alone", async () => {
    const { resolve, asked } = harness();
    expect(await resolve("https://example.com/")).toBe("https://example.com/");
    expect(asked).toEqual([]);
  });
});

describe("rewriteStatus", () => {
  it("rewrites the url of a preview status and keeps the rest", async () => {
    const { resolve } = harness();
    const status = { running: true, url: "http://127.0.0.1:5173/", root: "/p", error: null, mode: "project", label: "Vite", starting: false };
    expect(await rewriteStatus(status, resolve)).toEqual({ ...status, url: "https://p-5173-abcdefghij.web.bluethenics.com/" });
  });

  it("passes a status without a url through", async () => {
    const { resolve } = harness();
    const status = { running: false, url: null };
    expect(await rewriteStatus(status, resolve)).toBe(status);
  });
});
