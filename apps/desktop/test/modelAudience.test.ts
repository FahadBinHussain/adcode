import { expect, it } from "vitest";
import { AUDIENCE_ROLES, AUDIENCE_EXPERIENCE, DECLARED_USES, includedAiPersona } from "../src/shared/tagflow.ts";
import * as server from "../../../services/api/src/modelAudience.ts";

it("keeps the survey contract compatible without sharing application types with the service",() => {
  expect(AUDIENCE_ROLES).toEqual(server.AUDIENCE_ROLES);
  expect(AUDIENCE_EXPERIENCE).toEqual(server.AUDIENCE_EXPERIENCE);
  expect(DECLARED_USES).toEqual(server.DECLARED_USES);
});
it("reports fixed assistant categories without leaking custom names",() => {
  expect(includedAiPersona("chat")).toBe("coding-assistant");
  expect(includedAiPersona("completion")).toBe("inline-assistant");
  expect(includedAiPersona("agent","starter-reviewer")).toBe("reviewer");
  expect(includedAiPersona("agent","starter-tester")).toBe("tester");
  expect(includedAiPersona("agent","starter-ui-polish")).toBe("ui-polish");
  expect(includedAiPersona("agent","starter-bug-fixer")).toBe("bug-fixer");
  expect(includedAiPersona("agent","starter-docs-writer")).toBe("docs-writer");
  expect(includedAiPersona("agent","My private client project")).toBe("custom-agent");
  expect(includedAiPersona("agent","constructor")).toBe("custom-agent");
  expect(includedAiPersona("agent","default-agent")).toBe("coding-assistant");
  expect(server.observedUse("agent","reviewer")).toBe("code-review");
  expect(server.observedUse("agent","custom-agent")).toBe("agent-workflow");
});
