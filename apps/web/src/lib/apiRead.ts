import { API_ORIGIN } from "./site";

/**
 * Read this site's own public API from server code.
 *
 * In production the site and the API are one Cloudflare Worker, and a Worker cannot fetch
 * its own custom domain: the request failed, the caller caught it, and /versions, the blog
 * and the feed rendered "nothing published" on every live request - only a local build,
 * fetching from outside, ever saw the notes. So the API is called in-process, exactly as
 * the `/v1/*` route calls it. Where that cannot answer - a local build without the database
 * secrets - the public API is fetched over the network instead, which works from outside.
 */
export async function readApi(path: `/v1/${string}`, revalidate: number): Promise<Response> {
  try {
    const { handleApiRequest } = await import("./apiHandler");
    const response = await handleApiRequest(new Request(`${API_ORIGIN}${path}`));
    if (response.ok) return response;
  } catch {
    // No API in this environment; the public one below answers instead.
  }
  return fetch(`${API_ORIGIN}${path}`, { next: { revalidate } });
}
