/**
 * A request for `p-<port>-<previewId><PREVIEW_SUFFIX>`: the person's own app, from their sandbox.
 *
 * `/__adcode/auth?t=<nonce>&next=/path` trades a single-use nonce, minted for the owner's tab a
 * moment ago, for a host-only cookie signed for this preview id. Every other request needs that
 * cookie, and anything without it is a 404 - not a 401, so a stranger learns nothing about
 * whether the preview exists.
 */
import type { Env } from "./env.ts";
import { readCookie, signCookie } from "./previewAuth.ts";

const COOKIE = "adcode_preview";
const COOKIE_LIFETIME_MS = 12 * 60 * 60_000;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

/** Only a path on the same host: never an open redirect. */
function safeNext(next: string | null): string {
  return next !== null && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function previewRequest(request: Request, env: Env, port: number, previewId: string): Promise<Response> {
  const url = new URL(request.url);
  const route = env.PREVIEW.getByName(previewId);

  if (url.pathname === "/__adcode/auth") {
    const nonce = url.searchParams.get("t") ?? "";
    if (!(await route.consume(nonce))) return notFound();
    const value = await signCookie({ previewId, exp: Date.now() + COOKIE_LIFETIME_MS }, env.PREVIEW_COOKIE_KEY);
    return new Response(null, {
      status: 302,
      headers: {
        location: safeNext(url.searchParams.get("next")),
        "set-cookie": `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_LIFETIME_MS / 1000}`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }

  const cookie = cookieValue(request);
  const valid = cookie === null ? null : await readCookie(cookie, env.PREVIEW_COOKIE_KEY, Date.now());
  if (valid === null || valid.previewId !== previewId) return notFound();
  const owner = await route.owner();
  if (owner === null) return notFound();

  // Unchanged path and query; the header tells the owner's session this is a preview, and which port.
  const forwarded = new Request(request);
  forwarded.headers.set("x-adcode-preview-port", String(port));
  try {
    return await env.USER.getByName(owner).fetch(forwarded);
  } catch {
    return new Response("This preview is not answering.", { status: 502, headers: { "x-robots-tag": "noindex" } });
  }
}
