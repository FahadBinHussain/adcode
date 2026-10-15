import { unstable_cache } from "next/cache";
import { API_ORIGIN } from "./site";

/** What is kept of an in-process answer: enough to rebuild the `Response`. */
interface CachedAnswer {
  body: string;
  contentType: string | null;
}

/**
 * The in-process call, kept in Next's data cache for `revalidate` seconds.
 *
 * Without this every render read the database: `/docs`, which renders per request for its
 * `?q=` search, waited on Supabase each visit. Only a successful answer is kept - a failure
 * throws, which `unstable_cache` does not store, and the caller falls back as before.
 */
const readInProcess = (path: string, revalidate: number): Promise<CachedAnswer> =>
  unstable_cache(
    async (): Promise<CachedAnswer> => {
      const { handleApiRequest } = await import("./apiHandler");
      const response = await handleApiRequest(new Request(`${API_ORIGIN}${path}`));
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return { body: await response.text(), contentType: response.headers.get("content-type") };
    },
    ["readApi", path],
    { revalidate },
  )();

/**
 * Read this site's own public API from server code.
 *
 * In production the site and the API are one Cloudflare Worker, and a Worker cannot fetch
 * its own custom domain: the request failed, the caller caught it, and /versions, the blog
 * and the feed rendered "nothing published" on every live request - only a local build,
 * fetching from outside, ever saw the notes. So the API is called in-process, exactly as
 * the `/v1/*` route calls it, and the answer is cached like the fetch it replaced. Where
 * that cannot answer - a local build without the database secrets, or a test with no
 * Next cache - the public API is fetched over the network instead, which works from
 * outside.
 */
export async function readApi(path: `/v1/${string}`, revalidate: number): Promise<Response> {
  try {
    const answer = await readInProcess(path, revalidate);
    return new Response(answer.body, {
      status: 200,
      headers: answer.contentType === null ? {} : { "content-type": answer.contentType },
    });
  } catch {
    // No API in this environment; the public one below answers instead.
  }
  return fetch(`${API_ORIGIN}${path}`, { next: { revalidate } });
}
