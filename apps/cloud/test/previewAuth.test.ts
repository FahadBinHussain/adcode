/*
 * Private previews.
 *
 * A preview runs code the person (or their agent) wrote, served from a hostname under
 * bluethenics.com. Only its owner may open it: the hostname carries a random preview id, never
 * the uid, and a request needs a signed cookie for that exact id. A phishing page that only its
 * author can open has no victims.
 */
import { describe, expect, it } from "vitest";
import { newPreviewId, parsePreviewHost, previewHost, readCookie, rewriteLoopbackUrl, signCookie } from "../src/previewAuth.ts";

const SUFFIX = ".web.bluethenics.com";
const KEY = "a-test-signing-key-that-is-long-enough";

describe("preview hostnames", () => {
  it("round-trips a port and an id", () => {
    const host = previewHost(5173, "abcdefghij", SUFFIX);
    expect(host).toBe("p-5173-abcdefghij.web.bluethenics.com");
    expect(parsePreviewHost(host, SUFFIX)).toEqual({ port: 5173, previewId: "abcdefghij" });
  });

  it("refuses anything that is not exactly a preview host", () => {
    for (const host of [
      "web.bluethenics.com",
      "p-80-abcdefghij.web.bluethenics.com",
      "p-70000-abcdefghij.web.bluethenics.com",
      "p-5173-ABCDEFGHIJ.web.bluethenics.com",
      "p-5173-abcdefghij.evil.com",
      "x.p-5173-abcdefghij.web.bluethenics.com",
      "p-5173-abcdefghi.web.bluethenics.com",
    ]) {
      expect(parsePreviewHost(host, SUFFIX)).toBeNull();
    }
  });

  it("makes ids that fit the pattern and differ", () => {
    const a = newPreviewId();
    const b = newPreviewId();
    expect(a).toMatch(/^[a-z0-9]{10}$/);
    expect(a).not.toBe(b);
  });
});

describe("preview cookies", () => {
  it("reads back what it signed", async () => {
    const value = await signCookie({ previewId: "abcdefghij", exp: 2_000 }, KEY);
    expect(await readCookie(value, KEY, 1_000)).toEqual({ previewId: "abcdefghij", exp: 2_000 });
  });

  it("refuses a tampered, expired or foreign cookie", async () => {
    const value = await signCookie({ previewId: "abcdefghij", exp: 2_000 }, KEY);
    const [body, signature] = value.split(".");
    const forged = `${Buffer.from(JSON.stringify({ previewId: "zzzzzzzzzz", exp: 2_000 })).toString("base64url")}.${signature}`;
    expect(await readCookie(forged, KEY, 1_000)).toBeNull();
    expect(await readCookie(value, KEY, 3_000)).toBeNull();
    expect(await readCookie(value, "another-key-entirely-long-enough", 1_000)).toBeNull();
    expect(await readCookie(`${body}`, KEY, 1_000)).toBeNull();
    expect(await readCookie("", KEY, 1_000)).toBeNull();
  });
});

describe("rewriting sandbox addresses", () => {
  it("turns a sandbox-local address into its preview address, keeping path and query", () => {
    for (const local of ["http://localhost:5173/menu?x=1", "http://127.0.0.1:5173/menu?x=1", "http://0.0.0.0:5173/menu?x=1", "http://[::1]:5173/menu?x=1"]) {
      expect(rewriteLoopbackUrl(local, "abcdefghij", SUFFIX)).toBe("https://p-5173-abcdefghij.web.bluethenics.com/menu?x=1");
    }
  });

  it("leaves other addresses alone", () => {
    expect(rewriteLoopbackUrl("https://example.com/", "abcdefghij", SUFFIX)).toBeNull();
    expect(rewriteLoopbackUrl("http://localhost/", "abcdefghij", SUFFIX)).toBeNull();
    expect(rewriteLoopbackUrl("not a url", "abcdefghij", SUFFIX)).toBeNull();
  });
});
