import { describe, expect, it } from "vitest";
import { resendEmail } from "../src/mailingDelivery.ts";

describe("Resend's idempotent conflict responses", () => {
  it("retries an in-progress request without changing the key or treating a payload conflict as transient", async () => {
    for (const [name, retry] of [["concurrent_idempotent_requests", true], ["invalid_idempotent_request", false], ["unknown", false]] as const) {
      const result = await resendEmail(async (_url, options) => {
        expect(options?.headers).toMatchObject({ "Idempotency-Key": "receipt/stable" });
        return new Response(JSON.stringify({ name }), { status: 409 });
      }, "not-a-real-key", "receipt/stable", { subject: "test" });
      expect(result).toMatchObject({ retry, code: retry ? "provider-idempotency-in-progress" : "provider-409" });
    }
  });

  it("keeps malformed conflicts permanent while a network failure remains retryable", async () => {
    expect(await resendEmail(async () => new Response("not json", { status: 409 }), "test", "receipt/stable", {}))
      .toEqual({ retry: false, code: "provider-409" });
    expect(await resendEmail(async () => { throw new Error("socket closed"); }, "test", "receipt/stable", {}))
      .toEqual({ retry: true, code: "provider-timeout" });
  });
});
