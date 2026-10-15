import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatTurnDuration,
  joinsToolGroup,
  thinkingSummary,
  toolGroupCount,
  toolStepIcon,
  toolStepLabel,
  turnHeading,
} from "../src/renderer/ai/chatTimeline.ts";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const timelineSource = read("../src/renderer/ai/chatTimeline.ts");
const widgetSource = read("../src/renderer/ai/chatWidget.ts");
const styles = read("../src/renderer/styles/conversation.css");

describe("the turn's heading", () => {
  it("counts seconds, then minutes and seconds, then hours", () => {
    expect(formatTurnDuration(0.2)).toBe("1s");
    expect(formatTurnDuration(54.4)).toBe("54s");
    expect(formatTurnDuration(151)).toBe("2m 31s");
    expect(formatTurnDuration(180)).toBe("3m");
    expect(formatTurnDuration(3_725)).toBe("1h 2m");
  });

  it("says what the turn is doing, then what it did", () => {
    expect(turnHeading("running", 54)).toEqual({ lead: "Working", rest: "for 54s" });
    expect(turnHeading("worked", 151)).toEqual({ lead: "Worked", rest: "for 2m 31s" });
    // Thinking and an answer, no tools: it thought, it did not work.
    expect(turnHeading("thought", 5)).toEqual({ lead: "Thought", rest: "for 5s" });
    // A failed or stopped turn never claims it worked.
    expect(turnHeading("failed", 31)).toEqual({ lead: "Failed", rest: "after 31s" });
    expect(turnHeading("stopped", 12)).toEqual({ lead: "Stopped", rest: "after 12s" });
    expect(turnHeading("declined", 3)).toEqual({ lead: "Declined", rest: "" });
  });
});

describe("thinking rows", () => {
  it("summarise to the first line, without markdown markers", () => {
    expect(thinkingSummary("**Researching current date systems** I need to dig into...")).toBe("Researching current date systems I need to dig into...");
    expect(thinkingSummary("\n\n  ## Planning the page\nFirst the hero, then the pricing table.")).toBe("Planning the page");
    expect(thinkingSummary("   ")).toBe("");
    expect(thinkingSummary("x".repeat(400)).length).toBeLessThanOrEqual(160);
  });
});

describe("tool rows", () => {
  it("name a step the way a person would", () => {
    expect(toolStepLabel("read_file")).toBe("Read file");
    expect(toolStepLabel("search")).toBe("Search project");
    expect(toolStepLabel("glob_files")).toBe("Find files");
    expect(toolStepLabel("edit_file")).toBe("Edit file");
    expect(toolStepLabel("propose_edit")).toBe("Edit file");
    expect(toolStepLabel("run_command")).toBe("Run command");
    expect(toolStepLabel("fetch_url")).toBe("Read URL");
    expect(toolStepLabel("view_page")).toBe("View page");
    expect(toolStepLabel("update_plan")).toBe("Update plan");
    expect(toolStepLabel("memory_write")).toBe("Project memory");
    expect(toolStepLabel("call_mcp")).toBe("Use MCP tool");
    // An unknown tool still reads as words, not as an identifier.
    expect(toolStepLabel("make_thumbnail")).toBe("Make thumbnail");
    expect(toolStepLabel("")).toBe("Use a tool");
  });

  it("pick an icon by what the tool does", () => {
    expect(toolStepIcon("search")).toBe("search");
    expect(toolStepIcon("glob_files")).toBe("search");
    expect(toolStepIcon("fetch_url")).toBe("globe");
    expect(toolStepIcon("read_file")).toBe("file");
    expect(toolStepIcon("edit_file")).toBe("edit");
    expect(toolStepIcon("run_command")).toBe("terminal");
    expect(toolStepIcon("view_page")).toBe("eye");
    expect(toolStepIcon("update_plan")).toBe("checklist");
    expect(toolStepIcon("call_mcp")).toBe("plug");
    expect(toolStepIcon("make_thumbnail")).toBe("tool");
  });

  it("group a run of the same tool into one row with a count", () => {
    expect(toolGroupCount(1)).toBe("");
    expect(toolGroupCount(11)).toBe("11 calls");
    const group = { kind: "tools", name: "search" } as const;
    expect(joinsToolGroup(group, "search")).toBe(true);
    expect(joinsToolGroup(group, "read_file")).toBe(false);
    // Thinking or text between two searches starts a new row: the timeline reads in order.
    expect(joinsToolGroup({ kind: "thinking" }, "search")).toBe(false);
    expect(joinsToolGroup(null, "search")).toBe(false);
  });
});

describe("the timeline in the chat", () => {
  it("is one timeline per turn, with text inside it and the answer left outside when it ends", () => {
    expect(widgetSource).toContain("createTurnTimeline(");
    expect(widgetSource).not.toContain("createActivityBlock(");
    expect(timelineSource).toContain("releaseAnswer");
    // The streamed text joins the timeline, in order with the steps around it.
    expect(widgetSource).toContain("timeline.appendText(");
    // A heading over nothing but text is a placeholder: the text replaces it.
    expect(widgetSource).toContain("if (!timeline.hasSteps())");
  });

  it("shows thinking, with the full text a click away", () => {
    const thinking = widgetSource.slice(widgetSource.indexOf('case "thinking":'), widgetSource.indexOf('case "tool-call":'));
    expect(thinking).toContain('.thinking(String(event["text"] ?? ""))');
    expect(timelineSource).toContain("chat-step-detail");
    expect(timelineSource).toContain('aria-expanded');
  });

  it("keeps one face at work: the mascot in the heading, pixel spinners on live rows", () => {
    expect(timelineSource).toContain("createMascot(");
    expect(timelineSource).toContain("createPixelSpinner(");
    const finish = timelineSource.slice(timelineSource.indexOf("finish(outcome"), timelineSource.indexOf("destroy(): void {"));
    expect(finish).toContain("mascot.destroy()");
    expect(widgetSource).toContain("createPixelSpinner(");
  });

  it("moves smoothly, and not at all when asked not to", () => {
    expect(styles).toContain(".chat-turn-collapse");
    expect(styles).toContain("grid-template-rows");
    expect(styles).toContain("@keyframes chat-pixel");
    expect(styles).toContain("@keyframes chat-step-in");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain(':root[data-reduced-motion="true"] .chat-turn');
  });
});
