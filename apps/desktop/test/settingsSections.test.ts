import { describe, expect, it } from "vitest";
import { GROUPS } from "@adcode/settings";
import { initialSettingsGroup } from "../src/renderer/settings/settingsView.ts";

describe("settings sections", () => {
  it("opens on the section last used, and on the first one otherwise", () => {
    expect(initialSettingsGroup("git")).toBe("git");
    expect(initialSettingsGroup(null)).toBe(GROUPS[0]!.id);
    expect(initialSettingsGroup("not-a-section")).toBe(GROUPS[0]!.id);
  });
});
