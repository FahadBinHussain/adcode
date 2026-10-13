import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomProviderEditor } from "../src/components/CustomProviderEditor";
import { customProviderId, customProviderSecretName } from "@adcode/api/src/includedProviders.ts";

describe("custom provider setup", () => {
  it("shows setup and key instructions without asking for or including credentials", () => {
    const markup = renderToStaticMarkup(<CustomProviderEditor value={{ id: "custom-provider-one", name: "Provider one", baseUrl: "https://api.provider-one.com/v1" }} onChange={() => {}} onRemove={() => {}} />);
    expect(markup).toContain("API base URL");
    expect(markup).toContain("INCLUDED_AI_CUSTOM_PROVIDER_ONE_API_KEY");
    expect(markup).toContain("max_completion_tokens");
    expect(markup).toContain("Save first");
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('name="apiKey"');
    expect(customProviderSecretName("custom-provider-two")).toBe("INCLUDED_AI_CUSTOM_PROVIDER_TWO_API_KEY");
  });

  it("offers a separate daily allowance for the provider's models", () => {
    const value = { id: "custom-provider-one", name: "Provider one", baseUrl: "https://api.provider-one.com/v1" } as const;
    expect(renderToStaticMarkup(<CustomProviderEditor value={value} onChange={() => {}} onRemove={() => {}} />)).toContain("share the main daily allowance");
    const own = renderToStaticMarkup(<CustomProviderEditor value={{ ...value, limits: { dailyRequests: 1_000_000, dailyTokens: 10_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: 1000 } }} onChange={() => {}} onRemove={() => {}} />);
    expect(own).toContain("Tokens per day, per person");
    expect(own).toContain('value="10000000"');
  });

  it("reports the saved key's status", () => {
    const value = { id: "custom-provider-one", name: "Provider one", baseUrl: "https://api.provider-one.com/v1" } as const;
    expect(renderToStaticMarkup(<CustomProviderEditor value={value} keyStatus onChange={() => {}} onRemove={() => {}} />)).toContain("Key configured.");
    expect(renderToStaticMarkup(<CustomProviderEditor value={value} keyStatus={false} onChange={() => {}} onRemove={() => {}} />)).toContain("Key not configured yet");
  });

  it("keeps provider identity stable while models use it and escapes provider text", () => {
    const markup = renderToStaticMarkup(<CustomProviderEditor inUse value={{ id: "custom-provider-one", name: "<script>bad</script>", baseUrl: "https://api.provider-one.com/v1" }} onChange={() => {}} onRemove={() => {}} />);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Move or remove its models");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("derives a valid, unique ID from any name", () => {
    expect(customProviderId("Together AI", [])).toBe("custom-together-ai");
    expect(customProviderId("Together AI", ["custom-together-ai"])).toBe("custom-together-ai-2");
    expect(customProviderId("01.AI", [])).toBe("custom-p-01-ai");
    expect(customProviderId("", [])).toBe("custom-p");
    expect(customProviderId("x".repeat(80), [])).toMatch(/^custom-[a-z][a-z0-9-]{0,39}$/);
  });
});
