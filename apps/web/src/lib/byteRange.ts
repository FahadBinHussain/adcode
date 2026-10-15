/**
 * Byte ranges for the site's videos.
 *
 * Safari plays a `<video>` only from a server that answers `Range: bytes=0-1` with
 * `206 Partial Content` - on iPhone it refuses outright, on the Mac it stalls. Cloudflare's
 * static asset server ignores `Range` and sends the whole file with `200`, which Chrome
 * shrugs off and Safari does not. So `/videos/*` runs through the Worker first
 * (`run_worker_first` in wrangler.jsonc), and this cuts the requested bytes out of the
 * asset itself. The files are a few hundred kilobytes, so holding one in memory to slice
 * it is cheaper than anything cleverer.
 *
 * Plain TypeScript with no Worker types, so the rules are testable without a runtime.
 */

/** An inclusive byte range, as `Content-Range` states it. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * What a `Range` header asks of a file `size` bytes long.
 *
 * `null` means "send the whole file": no header, a malformed one, a unit other than bytes,
 * or several ranges at once - a server may always answer those with `200`, and no browser
 * asks a video for more than one range. `"unsatisfiable"` is the `416` case: a range that
 * starts past the end, or an empty suffix.
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (header === null) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (match === null) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;

  if (first === "") {
    // A suffix: the final N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Number(last);
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** The slice of the static asset server this needs: `env.ASSETS` in the Worker. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Answer a `/videos/*` request from the asset server, honouring `Range`.
 *
 * The asset is fetched without the `Range` header - the asset server would ignore it, and
 * without it the response keeps the `Cache-Control` and `ETag` it sends for whole files.
 * Conditional headers are passed on, so a `304` still saves the download.
 */
export async function serveWithRanges(request: Request, assets: AssetFetcher): Promise<Response> {
  const forwarded = new Headers(request.headers);
  forwarded.delete("range");
  forwarded.delete("if-range");
  const asset = await assets.fetch(new Request(request.url, { method: request.method, headers: forwarded }));

  const headers = new Headers(asset.headers);
  headers.set("accept-ranges", "bytes");
  const wanted = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const stillCurrent = ifRange === null || ifRange === asset.headers.get("etag");
  if (asset.status !== 200 || wanted === null || !stillCurrent) {
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  }

  const body = request.method === "HEAD" ? null : await asset.arrayBuffer();
  const size = body?.byteLength ?? Number(asset.headers.get("content-length"));
  if (!Number.isFinite(size)) return new Response(body, { status: 200, headers });

  const range = parseRange(wanted, size);
  if (range === null) return new Response(body, { status: 200, headers });

  headers.delete("content-encoding");
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }

  headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  headers.set("content-length", String(range.end - range.start + 1));
  return new Response(body?.slice(range.start, range.end + 1) ?? null, { status: 206, headers });
}
