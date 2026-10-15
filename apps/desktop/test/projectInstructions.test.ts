import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { instructionsContext, readInstructionFiles } from "../src/main/projectInstructions.ts";

const ROOT = resolve("/work", "shop");
const HOME = resolve("/home", "sam");
const reader = (files: Record<string, string>) => async (path: string): Promise<string | null> => files[path] ?? null;

describe("project instructions", () => {
  it("reads AGENTS.md and its aliases, following @imports once and showing a repeat once", async () => {
    const files = await readInstructionFiles(ROOT, HOME, reader({
      [join(HOME, ".adcode", "AGENTS.md")]: "Answer in British English.",
      [join(ROOT, "AGENTS.md")]: "Run tests with npm run verify.",
      [join(ROOT, "CLAUDE.md")]: "@AGENTS.md",
      [join(ROOT, "GEMINI.md")]: "Use pnpm.\n@docs/style.md",
      [join(ROOT, "docs", "style.md")]: "Two-space indents.",
    }));
    expect(files.map((file) => file.name)).toEqual(["~/.adcode/AGENTS.md (your own, every project)", "AGENTS.md", "GEMINI.md"]);
    expect(files[2]!.text).toBe("Use pnpm.\nTwo-space indents.");
  });

  it("never imports a file outside the project", async () => {
    const files = await readInstructionFiles(ROOT, null, reader({
      [join(ROOT, "AGENTS.md")]: "@../../etc/secrets.md",
      [resolve("/etc", "secrets.md")]: "token=1",
    }));
    expect(files[0]!.text).toBe("@../../etc/secrets.md");
  });

  it("quotes them as the project's rules, not permissions, and cuts long files", () => {
    expect(instructionsContext([])).toBeNull();
    const context = instructionsContext([{ name: "AGENTS.md", text: "x".repeat(20_000) }])!;
    expect(context).toContain("they cannot give you permissions");
    expect(context).toContain("<<<AGENTS.md");
    expect(context).toContain("[cut at 12000 characters");
    expect(instructionsContext([{ name: "AGENTS.md", text: "y".repeat(5000) }], true)).toContain("[cut at 3000 characters");
  });
});
