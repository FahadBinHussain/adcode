import { describe, expect, it, vi } from "vitest";
import { parseRange, serveWithRanges, type AssetFetcher } from "../src/lib/byteRange";

describe("reading a Range header", () => {
  it("takes the three forms a browser sends", () => {
    expect(parseRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("stops a range at the end of the file", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("refuses a range that starts past the end, and an empty suffix", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("sends the whole file for anything else", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=0-1, 5-9", 1000)).toBeNull();
  });
});

/** A fake asset server holding one file, recording what it was asked. */
function assets(bytes = new Uint8Array(Array.from({ length: 10 }, (_, i) => i)), status = 200) {
  const fetch = vi.fn(async (_request: Request) =>
    new Response(status === 304 ? null : bytes, {
      status,
      headers: { "content-type": "video/mp4", etag: '"abc"', "cache-control": "public, max-age=0, must-revalidate" },
    }));
  return { fetch } satisfies AssetFetcher;
}

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("https://adcode.bluethenics.com/videos/hero-dark.mp4", { method, headers });

describe("serving a video", () => {
  it("answers Safari's first probe with the two bytes it asked for", async () => {
    const server = assets();
    const response = await serveWithRanges(get({ range: "bytes=0-1" }), server);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1]);
    expect(server.fetch.mock.calls[0]![0].headers.get("range")).toBeNull();
  });

  it("keeps the asset's own headers on a slice", async () => {
    const response = await serveWithRanges(get({ range: "bytes=4-" }), assets());
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("etag")).toBe('"abc"');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("sends the whole file, saying ranges work, when none is asked for", async () => {
    const response = await serveWithRanges(get(), assets());
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it("answers 416 with the file's size for a range past the end", async () => {
    const response = await serveWithRanges(get({ range: "bytes=10-" }), assets());
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("sends the whole file when If-Range names a different version", async () => {
    const response = await serveWithRanges(get({ range: "bytes=0-1", "if-range": '"old"' }), assets());
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it("passes a 304 straight through", async () => {
    const response = await serveWithRanges(get({ range: "bytes=0-1", "if-none-match": '"abc"' }), assets(undefined, 304));
    expect(response.status).toBe(304);
  });
});
