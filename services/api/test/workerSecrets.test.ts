import { describe, expect, it, vi } from "vitest";
import { createWorkerSecrets } from "../src/workerSecrets.ts";

const account = "0123456789abcdef0123456789abcdef";
const ok = (body: unknown = { success: true }) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("worker secrets from the admin panel", () => {
  it("does nothing until its own token exists, and ignores wrangler's deploy token", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const secrets = createWorkerSecrets(() => ({ CLOUDFLARE_API_TOKEN: "deploy-token" } as never), fetchImpl);
    expect(secrets.configured()).toBe(false);
    expect(await secrets.put("INCLUDED_AI_CUSTOM_HEABSY_API_KEY", "sk-test-value")).toMatchObject({ ok: false, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes one secret to this Worker on api.cloudflare.com, finding the token's only account", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(ok({ result: [{ id: account }] })).mockResolvedValue(ok());
    const secrets = createWorkerSecrets(() => ({ CLOUDFLARE_SECRETS_TOKEN: "scoped-token" }), fetchImpl);
    expect(await secrets.put("INCLUDED_AI_CUSTOM_HEABSY_API_KEY", "sk-test-value")).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/adcode/secrets`);
    expect(init?.method).toBe("PUT"); expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer scoped-token");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "INCLUDED_AI_CUSTOM_HEABSY_API_KEY", text: "sk-test-value", type: "secret_text" });
    // The account is looked up once.
    expect(await secrets.remove("INCLUDED_AI_CUSTOM_HEABSY_API_KEY")).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]![0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/adcode/secrets/INCLUDED_AI_CUSTOM_HEABSY_API_KEY`);
  });

  it("reports refusals plainly and never sends an unsafe name", async () => {
    const refused = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 403 }));
    const secrets = createWorkerSecrets(() => ({ CLOUDFLARE_SECRETS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: account }), refused);
    expect(await secrets.put("GOOD_NAME", "value-123")).toMatchObject({ ok: false, reason: "rejected", message: expect.stringContaining("Workers Scripts: Edit") });
    expect(await secrets.put("../../evil", "value-123")).toMatchObject({ ok: false, reason: "rejected" });
    expect(refused).toHaveBeenCalledTimes(1);
    const many = createWorkerSecrets(() => ({ CLOUDFLARE_SECRETS_TOKEN: "t" }), vi.fn<typeof fetch>().mockResolvedValue(ok({ result: [{ id: account }, { id: account.replace("0", "1") }] })));
    expect(await many.put("GOOD_NAME", "value-123")).toMatchObject({ ok: false, message: expect.stringContaining("CLOUDFLARE_ACCOUNT_ID") });
    const offline = createWorkerSecrets(() => ({ CLOUDFLARE_SECRETS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: account }), vi.fn<typeof fetch>().mockRejectedValue(new Error("down")));
    expect(await offline.put("GOOD_NAME", "value-123")).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
