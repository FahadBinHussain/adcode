/**
 * Preview addresses on the web.
 *
 * In the sandbox, a dev server says `http://localhost:5173`. The person's browser needs the
 * preview's public address, `https://p-5173-<id>.web.bluethenics.com`, and needs that preview's
 * private cookie before the first load. The cloud hands the cookie out against a one-time code
 * (`/__adcode/auth?t=…&next=…`). Here the code is spent once, in the background, so the Preview
 * pane only ever sees the clean public address - which it can reload, navigate and show in its
 * address bar like any other. The cookie lasts 12 hours; the code is fetched again after 11.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const FRESH_MS = 11 * 60 * 60_000;

export interface PreviewUrlSource {
  /** The cloud's address for a sandbox-local URL (unchanged when there is no cloud in front). */
  previewUrl(url: string): Promise<string>;
}

/** Turns a sandbox-local address into one the person's browser can open. */
export function createPreviewResolver(
  source: PreviewUrlSource,
  /** Spends a one-time code so the browser holds the preview's cookie. */
  prime: (authUrl: string) => Promise<void>,
  now: () => number = Date.now,
): (localUrl: string) => Promise<string> {
  const known = new Map<string, { origin: string; at: number }>();

  return async (localUrl) => {
    let parsed: URL;
    try {
      parsed = new URL(localUrl);
    } catch {
      return localUrl;
    }
    if (!LOOPBACK.has(parsed.hostname)) return localUrl;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    const cached = known.get(parsed.origin);
    if (cached !== undefined && now() - cached.at < FRESH_MS) return `${cached.origin}${path}`;

    const address = await source.previewUrl(localUrl);
    let public_: URL;
    try {
      public_ = new URL(address);
    } catch {
      return localUrl;
    }
    if (public_.pathname !== "/__adcode/auth") return address;

    await prime(address).catch(() => undefined);
    known.set(parsed.origin, { origin: public_.origin, at: now() });
    return `${public_.origin}${path}`;
  };
}

/** A preview status with its address rewritten for the browser; everything else unchanged. */
export async function rewriteStatus<T extends { url: string | null }>(status: T, resolve: (localUrl: string) => Promise<string>): Promise<T> {
  if (status === null || typeof status !== "object" || typeof status.url !== "string") return status;
  return { ...status, url: await resolve(status.url) };
}

/** Spends a preview's one-time code: the response sets the cookie even though the page cannot read it. */
export async function primePreviewCookie(authUrl: string): Promise<void> {
  await fetch(authUrl, { mode: "no-cors", credentials: "include", redirect: "manual", cache: "no-store" });
}
