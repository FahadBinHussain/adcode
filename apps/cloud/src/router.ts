/**
 * The Worker's front door: who may reach which sandbox.
 *
 * A sandbox costs money from the moment it starts, so nothing reaches a person's `UserSession`
 * without a verified Firebase sign-in from an allowed page. Kept apart from the Durable Object
 * classes so it can be tested with stand-in bindings.
 *
 * - `/socket` (WebSocket): the tab's connection to its sandbox. The token travels in the
 *   subprotocol header. A refused sign-in is still accepted and closed with code 4401, because
 *   a close code is the only thing a browser can read from a refused upgrade.
 * - `/api/*` (Bearer token): session status, project download, deleting the cloud workspace.
 * - `/admin/stats`: spend and use, for admins.
 * - Preview hostnames go to `previewRoute` in `preview.ts`.
 * - Everything else is the web app's static files, with strict security headers.
 */
import { tokenFromProtocols, verifyIdToken, type Verified } from "./auth.ts";
import { forwardAccountApi } from "./accountApi.ts";
import type { Env } from "./env.ts";
import { parsePreviewHost } from "./previewAuth.ts";
import { INDEXABLE_LAUNCH_ROBOTS, LAUNCH_ROBOTS, publicAppHost, robots, sitemap, WEB_APP_SCHEMA_CSP } from "./seo.ts";

export interface RouterDeps {
  readonly verify: (token: string) => Promise<Verified | null>;
  /** Accept a WebSocket only to close it with a code the tab can read. */
  readonly refuseSocket: (code: number, reason: string) => Response;
  /** Hands a preview hostname's request on; absent in tests that do not exercise previews. */
  readonly preview?: (request: Request, port: number, previewId: string) => Promise<Response>;
}

export const DEV_UID = "web-dev-user";

export function defaultDeps(env: Env): RouterDeps {
  return {
    verify: async (token) => {
      if (env.ALLOW_DEV_TOKEN === "1" && token === "dev") return { uid: DEV_UID, email: "dev@localhost", exp: Number.MAX_SAFE_INTEGER };
      return verifyIdToken(token, env.FIREBASE_PROJECT_ID);
    },
    refuseSocket: (code, reason) => {
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "adcode.v1" } });
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
}

/** Forwards to the person's Durable Object at `path`, carrying who they are. */
function toUser(env: Env, request: Request, who: Verified, path: string): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(path, "https://user.session");
  target.search = url.search;
  const forwarded = new Request(target, request);
  // Only the Worker says who someone is, or that a request is a preview.
  for (const name of ["x-adcode-uid", "x-adcode-email", "x-adcode-preview-port"]) forwarded.headers.delete(name);
  forwarded.headers.set("x-adcode-uid", who.uid);
  if (who.email !== null) forwarded.headers.set("x-adcode-email", who.email);
  return env.USER.getByName(who.uid).fetch(forwarded);
}

export function contentSecurityPolicy(env: Env): string {
  const previews = `https://*${env.PREVIEW_SUFFIX}`;
  return [
    "default-src 'none'",
    // 'wasm-unsafe-eval' compiles the bundled syntax grammars; apis.google.com is Firebase's sign-in popup helper.
    `script-src 'self' 'wasm-unsafe-eval' https://apis.google.com ${WEB_APP_SCHEMA_CSP}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    `connect-src 'self' wss://${env.APP_HOST} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://apis.google.com`,
    `frame-src ${previews} https://${env.FIREBASE_AUTH_DOMAIN} https://accounts.google.com`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function servePage(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  let body = response.body;
  let status = response.status;
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if ((headers.get("content-type") ?? "").includes("text/html")) {
    headers.set("content-security-policy", contentSecurityPolicy(env));
    headers.set("cache-control", "no-cache");
    headers.set("x-robots-tag", "noindex, nofollow");
    const publicRoot = publicAppHost(url.hostname, env.APP_HOST, env.ALLOW_DEV_TOKEN) && url.pathname === "/" && url.search === "" && status === 200;
    if (publicRoot && request.method === "GET") {
      const html = await response.text();
      // An old build without the public introduction must remain noindex.
      const indexable = html.includes(LAUNCH_ROBOTS);
      body = new Response(indexable ? html.replace(LAUNCH_ROBOTS, INDEXABLE_LAUNCH_ROBOTS) : html).body;
      if (indexable) headers.set("x-robots-tag", "index, follow, max-image-preview:large");
      headers.delete("content-length");
      headers.delete("etag");
    } else if (publicRoot && request.method === "HEAD") {
      // Crawlers learn indexing from GET; HEAD has no HTML to verify the launch marker.
      headers.delete("x-robots-tag");
    }
    // The asset binding's SPA fallback otherwise makes every nonexistent path a soft 404.
    if (url.pathname !== "/" && url.pathname !== "/index.html" && status === 200) status = 404;
  }
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

export async function route(request: Request, env: Env, deps: RouterDeps = defaultDeps(env)): Promise<Response> {
  const url = new URL(request.url);

  const preview = parsePreviewHost(url.hostname, env.PREVIEW_SUFFIX);
  if (preview !== null) {
    return deps.preview === undefined ? new Response("Not found", { status: 404 }) : deps.preview(request, preview.port, preview.previewId);
  }
  // A hostname under the preview suffix that is not a well-formed preview is nothing at all.
  if (url.hostname.endsWith(env.PREVIEW_SUFFIX)) return new Response("Not found", { status: 404 });

  if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
    const headers = new Headers({ "content-type": url.pathname === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-robots-tag": "noindex" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("allow", "GET, HEAD");
      return new Response("Method not allowed", { status: 405, headers });
    }
    const publicHost = publicAppHost(url.hostname, env.APP_HOST, env.ALLOW_DEV_TOKEN);
    const body = url.pathname === "/robots.txt" ? robots(publicHost) : sitemap(publicHost);
    return new Response(request.method === "HEAD" ? null : body, { headers });
  }

  if (url.pathname.startsWith("/v1/")) {
    const token = bearer(request);
    if (token === null || token === "dev" || await deps.verify(token) === null) return json({ error: "unauthenticated" }, 401);
    return forwardAccountApi(request, env);
  }

  if (url.pathname === "/socket") {
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const allowed = env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter((origin) => origin.length > 0);
    if (!allowed.includes(request.headers.get("origin") ?? "")) return new Response("Forbidden", { status: 403 });
    const token = tokenFromProtocols(request.headers.get("sec-websocket-protocol"));
    const who = token === null ? null : await deps.verify(token);
    if (who === null) return deps.refuseSocket(4401, "Signed out");
    return toUser(env, request, who, "/socket");
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) {
    const token = bearer(request);
    const who = token === null ? null : await deps.verify(token);
    if (who === null) return json({ ok: false, error: "Sign in first" }, 401);

    switch (url.pathname) {
      case "/api/session":
        return toUser(env, request, who, "/status");
      case "/api/download":
        return toUser(env, request, who, "/download");
      case "/api/delete":
        if (request.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
        return toUser(env, request, who, "/delete");
      case "/admin/stats": {
        const admins = env.ADMIN_UIDS.split(",").map((uid) => uid.trim()).filter((uid) => uid.length > 0);
        if (!admins.includes(who.uid)) return json({ ok: false }, 403);
        return json(await env.BUDGET.getByName("global").stats());
      }
      default:
        return json({ ok: false, error: "Not found" }, 404);
    }
  }

  return servePage(request, env);
}
