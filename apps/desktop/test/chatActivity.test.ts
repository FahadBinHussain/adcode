import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSafeImageSrc,
  summarizeToolInput,
  toolHeaderLabel,
} from "../src/renderer/ai/chatActivity.ts";
import { isSafeMarkdownImageSrc, renderChatMessageHtml } from "../src/renderer/ai/chatMarkdown.ts";

const activitySource = readFileSync(
  new URL("../src/renderer/ai/chatActivity.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const widgetSource = readFileSync(
  new URL("../src/renderer/ai/chatWidget.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const styles = readFileSync(
  new URL("../src/renderer/styles/ai.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("ActivityBlock model (pure, no DOM)", () => {
  it("summarizes tool input to one scannable line", () => {
    expect(summarizeToolInput({ path: "src/main.ts", contents: "x".repeat(500) })).toBe("src/main.ts");
    expect(summarizeToolInput("direct string")).toBe("direct string");
    expect(summarizeToolInput(null)).toBe("");
  });

  it("maps tool names to step labels", () => {
    expect(toolHeaderLabel("read_file")).toBe("Reading files");
    expect(toolHeaderLabel("edit_file")).toBe("Editing files");
    expect(toolHeaderLabel("project_context")).toBe("Reading project notes");
    expect(toolHeaderLabel("get_outline")).toBe("Outlining a file");
    expect(toolHeaderLabel("propose_edit")).toBe("Editing files");
    expect(toolHeaderLabel("view_page")).toBe("Looking at the page");
    expect(toolHeaderLabel("open_preview")).toBe("Opening the preview");
    expect(toolHeaderLabel("update_plan")).toBe("Updating the plan");
    expect(toolHeaderLabel("ask_user")).toBe("Asking you a question");
    expect(toolHeaderLabel("move_file")).toBe("Moving files");
    expect(toolHeaderLabel("delete_file")).toBe("Deleting a file");
    expect(toolHeaderLabel("command_output")).toBe("Checking a command");
    expect(toolHeaderLabel("stop_command")).toBe("Stopping a command");
    expect(summarizeToolInput({ from: "logo.png", to: "assets/logo.png" })).toBe("logo.png → assets/logo.png");
    expect(summarizeToolInput({ questions: [{ question: "Which layout?" }, { question: "And the title?" }] })).toBe("Which layout? (+1 more)");
    expect(toolHeaderLabel("")).toBe("Working");
  });

  it("allow-lists result image sources", () => {
    expect(isSafeImageSrc("https://example.com/preview.png")).toBe(true);
    expect(isSafeImageSrc("data:image/png;base64,abcd")).toBe(true);
    expect(isSafeImageSrc("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownImageSrc("https://example.com/a.png")).toBe(true);
    expect(isSafeMarkdownImageSrc("file:///etc/passwd")).toBe(false);
  });

  it("renders markdown images as result cards, never raw HTML", () => {
    const html = renderChatMessageHtml("![Preview](https://example.com/a.png)");
    expect(html).toContain("chat-result-image");
    expect(html).toContain('src="https://example.com/a.png"');
    const injected = renderChatMessageHtml("<img src=x onerror=alert(1)>");
    expect(injected).not.toContain("<img");
  });
});

describe("Agent Chat v2 wiring", () => {
  // The turn itself - heading, thinking, grouped tools, the fold - is tested in
  // chatTimeline.test.ts; this file keeps the chat around it.
  it("draws each turn as a timeline, not one block per run of work", () => {
    expect(widgetSource).toContain("ensureTimeline()");
    expect(widgetSource).toContain("finishTimeline()");
    expect(widgetSource).toContain("resetActivity()");
    expect(widgetSource).not.toContain("closeActivitySegment()");
    expect(activitySource).not.toContain("createActivityBlock");
  });

  it("keeps the v2 composer contract", () => {
    expect(widgetSource).toContain("Ask anything or describe what to build · / for commands · @ for files");
    expect(widgetSource).toContain("autogrowComposer");
    expect(widgetSource).toContain("140");
    expect(widgetSource).toContain("chat-mode-pill");
    expect(widgetSource).toContain('aria-busy');
  });

  it("marks history rows with working / forked / idle status", () => {
    expect(widgetSource).toContain("chat-history-status");
    expect(widgetSource).toContain("paintWorkingStatus()");
  });

  it("carries the reference theme and motion in CSS only", () => {
    // The palette lives in tokens.css for the whole app; the chat keeps only
    // its working indicators, following the theme accent and success.
    const tokens = readFileSync(
      new URL("../src/renderer/styles/tokens.css", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    for (const token of ["#151515", "#100f0c", "#1c1b19", "#ebe8e1", "#8f8c85", "#5f5d58", "#2d2b28", "#ece9e2", "#6fb98f"]) {
      expect(tokens).toContain(token);
    }
    expect(styles).toContain("chat-caret-blink");
    expect(styles).toContain("chat-result-reveal");
    expect(styles).toContain("grid-template-rows");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain(".chat-transcript");
    expect(widgetSource).toContain('role", "log"');
    expect(widgetSource).toContain('aria-live", "polite"');
  });

  it("stays professional: no nested focus ring, no empty box, no duplicate status", () => {
    expect(styles).toContain(".chat-card .chat-input:focus-visible");
    expect(styles).toContain("outline: none");
    expect(widgetSource).toContain("working.hidden = true");
  });

  it("fails loudly and guides: failed labels, connect nudge, setup steps", () => {
    expect(widgetSource).toContain('finishTimeline("failed")');
    expect(widgetSource).toContain("finishActivityFailed()");
    expect(widgetSource).toContain("connectNudge(");
    expect(widgetSource).toContain("chat-setup-steps");
    expect(widgetSource).toContain("chat-setup-status");
    expect(styles).toContain(".chat-setup-steps");
    expect(styles).toContain(".chat-nudge-action");
  });

  it("lays messages out tight, with time, edit, retry, and a popup menu", () => {
    expect(widgetSource).toContain("userMessageActions");
    expect(widgetSource).toContain("chat-message-menu");
    expect(widgetSource).toContain("chat-message-time");
    expect(widgetSource).toContain('dataset["at"]');
    expect(styles).toContain(".chat-message-menu");
    expect(styles).toContain(".chat-message-time");
    expect(styles).toContain(".chat-message-more-wrap");
  });

  it("reads like a working log, and arrives smoothly", () => {
    expect(styles).toContain(".chat-card .chat-bubble-user");
    expect(styles).toContain(".chat-card .chat-conversation-title");
    expect(styles).toContain("chat-popup-in 300ms");
    expect(styles).toContain("chat-menu-in");
    expect(styles).toContain("transform-origin: top right");
  });

  it("uses SVG, never emoji, across the chat surface", () => {
    const icons = readFileSync(
      new URL("../src/renderer/workbench/icons.ts", import.meta.url),
      "utf8",
    );
    expect(icons).toContain("mic:");
    expect(icons).toContain("more:");
    for (const glyph of ["👍", "👎", "🎙"]) {
      expect(widgetSource).not.toContain(glyph);
    }
    const connect = readFileSync(
      new URL("../src/renderer/ai/connectView.ts", import.meta.url),
      "utf8",
    );
    for (const glyph of ["👍", "👎", "🎙"]) {
      expect(connect).not.toContain(glyph);
    }
  });
});
