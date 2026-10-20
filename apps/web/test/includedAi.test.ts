import { describe, expect, it } from "vitest";
import { parseIncludedAiView } from "../src/lib/includedAi";

/**
 * `/v1/ai/tagflow/config` is what the public header lists. It is also the only public
 * answer that already excludes disabled models and providers without a key, so a parser
 * that quietly drops a model would make the header undercount what is actually offered.
 */
const good = () => ({
  available: true,
  defaultModel: "tagflow-code-27b",
  requiresVerifiedAccount: true,
  unlimited: true,
  models: [
    {
      id: "tagflow-code-27b",
      name: "Tagflow Code 27B",
      providerName: "Tagflow",
      contextWindow: 262_144,
      maxOutput: 32_768,
      creditRate: 1,
    },
    {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      providerName: "Anthropic",
      contextWindow: 200_000,
      maxOutput: 64_000,
      creditRate: 2,
    },
  ],
});

describe("parseIncludedAiView", () => {
  it("reads the public directory whole", () => {
    const view = parseIncludedAiView(good());

    expect(view?.available).toBe(true);
    expect(view?.defaultModel).toBe("tagflow-code-27b");
    expect(view?.models.map((model) => [model.id, model.providerName, model.creditRate])).toEqual([
      ["tagflow-code-27b", "Tagflow", 1],
      ["claude-sonnet-4-5", "Anthropic", 2],
    ]);
  });

  it("reads a paused directory as paused rather than as a failed request", () => {
    const view = parseIncludedAiView({ ...good(), available: false, models: [] });
    expect(view?.available).toBe(false);
    expect(view?.models).toEqual([]);
  });

  it("keeps the models it can read when a sibling is malformed", () => {
    const view = parseIncludedAiView({
      ...good(),
      models: [good().models[0], { id: "no-name" }, "not a model"],
    });
    expect(view?.models.map((model) => model.id)).toEqual(["tagflow-code-27b"]);
  });

  it("drops a duplicate id rather than listing the same model twice", () => {
    const view = parseIncludedAiView({
      ...good(),
      models: [good().models[0], { ...good().models[0], name: "Again" }],
    });
    expect(view?.models).toHaveLength(1);
    expect(view?.models[0]?.name).toBe("Tagflow Code 27B");
  });

  it("fills the quiet defaults instead of refusing the whole answer", () => {
    const view = parseIncludedAiView({
      ...good(),
      models: [{ id: "m", name: "M", contextWindow: 100_000 }],
    });
    expect(view?.models[0]).toMatchObject({ providerName: "Included AI", creditRate: 1, maxOutput: 0 });
  });

  it.each([
    ["nothing", undefined],
    ["a string", "ok"],
    ["no availability", { ...good(), available: undefined }],
    ["no default", { ...good(), defaultModel: undefined }],
    ["models that are not a list", { ...good(), models: {} }],
  ])("refuses %s", (_label, raw) => {
    expect(parseIncludedAiView(raw)).toBeNull();
  });
});
