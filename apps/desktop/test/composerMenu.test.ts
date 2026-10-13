import { describe, expect, it } from "vitest";
import {
  CHECK_APP_PROMPT,
  SLASH_COMMANDS,
  contextChipName,
  expandSlashCommand,
  parseSlashCommand,
  matchSlashCommands,
  menuTriggerAt,
  rememberPrompt,
  replaceTrigger,
} from "../src/renderer/ai/composerMenu.ts";

describe("menuTriggerAt", () => {
  it("opens slash only as the very first character", () => {
    expect(menuTriggerAt("/re", 3)).toEqual({ kind: "slash", start: 0, query: "re" });
    expect(menuTriggerAt("/", 1)).toEqual({ kind: "slash", start: 0, query: "" });
    expect(menuTriggerAt("fix /re", 7)).toBeNull();
    expect(menuTriggerAt("src/app", 7)).toBeNull();
  });

  it("opens mentions at the start or after whitespace, never inside words", () => {
    expect(menuTriggerAt("@src", 4)).toEqual({ kind: "mention", start: 0, query: "src" });
    expect(menuTriggerAt("read @src/ap", 12)).toEqual({ kind: "mention", start: 5, query: "src/ap" });
    expect(menuTriggerAt("me@example.com", 14)).toBeNull();
    expect(menuTriggerAt("no trigger here", 15)).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("lists everything on an empty query", () => {
    expect(matchSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("ranks prefix matches before substring matches", () => {
    expect(matchSlashCommands("re").map((command) => command.id)).toEqual([
      "review",
      "refactor",
      "build",
      "preview",
    ]);
  });

  it("matches hints as well as ids", () => {
    expect(matchSlashCommands("commit message").map((command) => command.id)).toContain("commit");
  });
});

describe("parseSlashCommand", () => {
  it("reads a command typed out in full and the words after it", () => {
    expect(parseSlashCommand("/fix the login bug")).toMatchObject({ command: { id: "fix" }, rest: "the login bug" });
    expect(parseSlashCommand("  /Review   focus on auth  ")).toMatchObject({ command: { id: "review" }, rest: "focus on auth" });
    expect(parseSlashCommand("/new")).toMatchObject({ command: { id: "new" }, rest: "" });
    expect(parseSlashCommand("/plan\nstep one\nstep two")).toMatchObject({ command: { id: "plan" }, rest: "step one\nstep two" });
  });

  it("leaves paths, unknown commands and mid-sentence slashes alone", () => {
    expect(parseSlashCommand("/etc/hosts is wrong")).toBeNull();
    expect(parseSlashCommand("/src/app.ts fails to build")).toBeNull();
    expect(parseSlashCommand("/fixit now")).toBeNull();
    expect(parseSlashCommand("please /fix this")).toBeNull();
    expect(parseSlashCommand("/ fix")).toBeNull();
  });
});

describe("expandSlashCommand", () => {
  it("gives the model the command's instruction followed by the person's words", () => {
    const fix = SLASH_COMMANDS.find((command) => command.id === "fix")!;
    expect(expandSlashCommand("/fix the login bug")).toBe(`${fix.prompt}the login bug`);
    const review = SLASH_COMMANDS.find((command) => command.id === "review")!;
    expect(expandSlashCommand("/review focus on auth")).toBe(`${review.prompt}\n\nfocus on auth`);
  });

  it("closes the instruction as a sentence when nothing follows", () => {
    expect(expandSlashCommand("/explain")).toBe("Explain how this works, step by step and in plain words, pointing at the files and lines involved.");
    expect(expandSlashCommand("/check")).toBe(CHECK_APP_PROMPT.trim());
    expect(expandSlashCommand("/commit")).toBe(SLASH_COMMANDS.find((command) => command.id === "commit")!.prompt);
  });

  it("sends anything else exactly as written, actions included", () => {
    expect(expandSlashCommand("what does /fix do?")).toBe("what does /fix do?");
    expect(expandSlashCommand("/etc/hosts")).toBe("/etc/hosts");
    expect(expandSlashCommand("/new")).toBe("/new");
  });

  it("gives every prompt and diff command an instruction", () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.kind === "action" ? command.prompt === undefined : (command.prompt?.length ?? 0) > 20, command.id).toBe(true);
    }
  });
});

describe("replaceTrigger", () => {
  it("swaps the trigger span for the insert and lands the caret after it", () => {
    expect(replaceTrigger("/re", 3, { kind: "slash", start: 0, query: "re" }, "")).toEqual({
      text: "",
      caret: 0,
    });
    expect(
      replaceTrigger("read @src/ap", 12, { kind: "mention", start: 5, query: "src/ap" }, "@src/app.ts "),
    ).toEqual({ text: "read @src/app.ts ", caret: 17 });
  });
});

describe("contextChipName", () => {
  it("names file slices like an editor status bar", () => {
    expect(contextChipName("src/app.ts")).toBe("app.ts");
    expect(contextChipName("src/app.ts", 12, 12)).toBe("app.ts:12");
    expect(contextChipName("src/app.ts", 12, 40)).toBe("app.ts:12-40");
  });
});

describe("rememberPrompt", () => {
  it("bounds history and drops consecutive duplicates", () => {
    expect(rememberPrompt(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(rememberPrompt(["a"], "b")).toEqual(["a", "b"]);
    expect(rememberPrompt([], "   ")).toEqual([]);
    expect(rememberPrompt(["a", "b", "c"], "d", 2)).toEqual(["c", "d"]);
  });
});
