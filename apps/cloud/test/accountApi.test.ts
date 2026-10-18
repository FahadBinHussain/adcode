import { describe, expect, it, vi } from "vitest";
import { route, type RouterDeps } from "../src/router.ts";
import { accountApiAllowed } from "../src/accountApi.ts";
import type { Env } from "../src/env.ts";
const deps: RouterDeps = {
  verify: async (token) => token === "test-token" ? { uid: "test-user", email: null, exp: 9999999999 } : null,
  refuseSocket: () => new Response(null, { status: 401 }),
};
function setup() {
  const api = vi.fn(async (_request: Request) => Response.json({ availableMicros: "1234" }));
  const sandbox = vi.fn();
  const env = { PREVIEW_SUFFIX: ".web.example", ACCOUNT_API: { fetch: api }, USER: { getByName: sandbox } } as unknown as Env;
  return { api, sandbox, env };
}
const request = (path = "/balance", init: RequestInit = {}) => new Request(`https://web.example/v1${path}`, { ...init, headers: { authorization: "Bearer test-token", ...init.headers } });
describe("account inside Vibe", () => {
  it("forwards authenticated account reads without waking a sandbox or caching private data", async () => {
    const { env, api, sandbox } = setup();
    const response = await route(request("/ledger?limit=25&cursor=abc"), env, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(api.mock.calls[0]?.[0].url).toBe("https://adcode.bluethenics.com/v1/ledger?limit=25&cursor=abc");
    expect(api.mock.calls[0]?.[0].headers.get("authorization")).toBe("Bearer test-token");
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("preserves writes and strips caller-controlled identity and cookies", async () => {
    const { env, api } = setup();
    const response = await route(request("/email-preferences", { method: "PATCH", body: JSON.stringify({ subscribed: false }), headers: { "content-type": "application/json", cookie: "private=1", "x-adcode-uid": "someone-else" } }), env, deps);
    expect(response.status).toBe(200);
    const forwarded = api.mock.calls[0]![0];
    expect(forwarded.method).toBe("PATCH");
    expect(await forwarded.json()).toEqual({ subscribed: false });
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("x-adcode-uid")).toBe(false);
    expect(forwarded.redirect).toBe("manual");
  });
  it("rejects missing, expired and development tokens before reaching the API", async () => {
    const { env, api } = setup();
    for (const token of ["", "expired", "dev"]) {
      const response = await route(request("/balance", { headers: { authorization: token ? `Bearer ${token}` : "" } }), env, deps);
      expect(response.status).toBe(401);
    }
    expect(api).not.toHaveBeenCalled();
  });
  it("cannot proxy admin operations or arbitrary endpoints", async () => {
    const { env, api } = setup();
    for (const path of ["/admin/people", "/unknown", "/withdrawals"]) expect((await route(request(path, { method: "DELETE" }), env, deps)).status).toBe(404);
    expect(api).not.toHaveBeenCalled();
    expect(accountApiAllowed("/v1/withdrawals/w_123/cancel", "POST")).toBe(true);
    expect(accountApiAllowed("/v1/withdrawals/w_123/cancel/extra", "POST")).toBe(false);
  });
  it("does not follow redirects and handles an unavailable account service", async () => {
    const { env, api } = setup();
    api.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example" } }));
    expect((await route(request(), env, deps)).status).toBe(502);
    api.mockRejectedValueOnce(new Error("unavailable"));
    expect((await route(request(), env, deps)).status).toBe(503);
  });
});
