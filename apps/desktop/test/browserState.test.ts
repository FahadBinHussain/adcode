import { describe, expect, it } from "vitest";
import { browserDraftKey, browserFileDiff, shouldSendBrowserMessage, updateBrowserHistory, updateBrowserProposals } from "../src/web/browserState.ts";

describe("browser draft account isolation", () => {
  it("keeps drafts separate across accounts and conversations", () => {
    expect(browserDraftKey("person-a", "chat-1")).not.toBe(browserDraftKey("person-b", "chat-1"));
    expect(browserDraftKey("person-a", "chat-1")).not.toBe(browserDraftKey("person-a", "chat-2"));
    expect(browserDraftKey("person-a")).not.toBe(browserDraftKey("person-a", "chat-1"));
  });

  it("does not persist drafts into a shared anonymous namespace", () => {
    expect(browserDraftKey(undefined)).toBeNull();
    expect(browserDraftKey(null)).toBeNull();
    expect(browserDraftKey("")).toBeNull();
  });

  it("escapes identifiers so namespace separators cannot collide", () => {
    expect(browserDraftKey("account:chat", "1")).not.toBe(browserDraftKey("account", "chat:1"));
  });
});

describe("browser conversation state", () => {
  it("replaces an existing history item and retains chronological order", () => {
    const old = [{ id: "a", title: "First", updatedAt: 10 }, { id: "b", title: "Second", updatedAt: 20 }];
    expect(updateBrowserHistory(old, { id: "a", title: "Updated", updatedAt: 30 })).toEqual([
      { id: "a", title: "Updated", updatedAt: 30 }, { id: "b", title: "Second", updatedAt: 20 },
    ]);
    expect(old[0]!.title).toBe("First");
  });

  it("replaces a staged file with its final proposal including a deletion", () => {
    const old = [{ path: "one.ts", content: "initial" }, { path: "two.ts", content: "keep" }];
    expect(updateBrowserProposals(old, { path: "one.ts", content: null })).toEqual([
      { path: "two.ts", content: "keep" }, { path: "one.ts", content: null },
    ]);
    expect(old[0]!.content).toBe("initial");
  });

  it("does not submit IME composition or Shift+Enter", () => {
    expect(shouldSendBrowserMessage({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendBrowserMessage({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSendBrowserMessage({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  });
});

describe("reviewing proposed file changes", () => {
  it("shows a changed block with unchanged surrounding context", () => {
    expect(browserFileDiff("first\nold\nlast", "first\nnew\nlast")).toEqual([
      { kind: "context", text: "first" }, { kind: "removed", text: "old" },
      { kind: "added", text: "new" }, { kind: "context", text: "last" },
    ]);
  });

  it("distinguishes adding an empty file from deleting it", () => {
    expect(browserFileDiff(null, "")).toEqual([{ kind: "added", text: "" }]);
    expect(browserFileDiff("", null)).toEqual([{ kind: "removed", text: "" }]);
  });

  it("preserves code and HTML as plain diff data", () => {
    expect(browserFileDiff(null, "<script>alert('x')</script>")).toEqual([{ kind: "added", text: "<script>alert('x')</script>" }]);
  });

  it("keeps only nearby unchanged lines for large files", () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `line ${index}`);
    const after = [...lines];
    after[10_000] = "changed";
    const diff = browserFileDiff(lines.join("\n"), after.join("\n"));
    expect(diff).toHaveLength(8);
    expect(diff.filter((line) => line.kind === "added")).toEqual([{ kind: "added", text: "changed" }]);
  });
});
