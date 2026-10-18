import type { Env } from "./env.ts";

const READ = new Set(["/v1/balance", "/v1/ledger", "/v1/activity", "/v1/referrals", "/v1/payouts", "/v1/payout-corridors", "/v1/email-preferences"]);
export function accountApiAllowed(path: string, method: string): boolean {
  if (method === "GET") return READ.has(path);
  if (method === "PATCH") return path === "/v1/referrals" || path === "/v1/email-preferences";
  if (method === "POST") return ["/v1/referrals/claim", "/v1/payouts/profile", "/v1/withdrawals"].includes(path) || /^\/v1\/withdrawals\/[a-zA-Z0-9_-]+\/cancel$/.test(path);
  return false;
}

/** The existing API authenticates the same Firebase token; no coding sandbox is involved. */
export async function forwardAccountApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!accountApiAllowed(url.pathname, request.method)) return Response.json({ error: "not-found" }, { status: 404 });
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const forwarded = new Request(`https://adcode.bluethenics.com${url.pathname}${url.search}`, request);
    const response = await env.ACCOUNT_API.fetch(new Request(forwarded, { headers, redirect: "manual" }));
    if (response.status >= 300 && response.status < 400) return Response.json({ error: "provider-unavailable" }, { status: 502 });
    const outgoing = new Headers({ "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: "provider-unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
