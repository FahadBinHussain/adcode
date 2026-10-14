/*
 * Shortcuts the browser keeps for itself.
 *
 * In a browser tab, Ctrl+N, Ctrl+Shift+N, Ctrl+W and Ctrl+T open or close windows and tabs
 * before a page ever sees them. On the web the commands bound to them move to Alt, so New
 * conversation is Alt+N there - and a shortcut the person set themselves always wins.
 */
import { describe, expect, it } from "vitest";
import { isBindableChord, resolveBindings } from "../src/shared/keybindings.ts";
import { webShortcutOverrides } from "../src/shared/webShortcuts.ts";

describe("web shortcuts", () => {
  const bindings = resolveBindings({});
  const overrides = webShortcutOverrides(bindings);

  it("moves New conversation to Alt+N", () => {
    expect(overrides["ai.newConversation"]).toBe("Alt+N");
  });

  it("moves every other browser-reserved default off its chord", () => {
    expect(overrides["file.new"]).toBe("Alt+Shift+N");
    expect(overrides["editor.close"]).toBe("Alt+W");
    for (const chord of Object.values(overrides)) expect(chord === null || isBindableChord(chord)).toBe(true);
  });

  it("leaves shortcuts the browser does not take alone", () => {
    expect(Object.hasOwn(overrides, "file.save")).toBe(false);
    expect(Object.hasOwn(overrides, "edit.find")).toBe(false);
  });

  it("keeps a shortcut the person chose, even on a reserved command", () => {
    const mine = { "ai.newConversation": "CmdOrCtrl+Alt+J" };
    const resolved = resolveBindings({ ...webShortcutOverrides(resolveBindings({})), ...mine });
    expect(resolved.find((binding) => binding.command === "ai.newConversation")?.chord).toBe("CmdOrCtrl+Alt+J");
  });
});
