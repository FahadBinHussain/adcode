/*
 * Which features each surface offers.
 *
 * The web version is Vibe only: no code editor, no terminal panel, no second window. Every help
 * surface - the Feature library, universal search, the guide, the settings popover - reads the
 * catalogue, so the catalogue is where "not on the web" is decided, once. A feature the web
 * cannot reach is never advertised there, and the desktop keeps everything it has.
 */
import { afterEach, describe, expect, it } from "vitest";
import { featureFor, featureRecords, helpForGroup, searchFeatures, searchHelp, setFeatureSurface } from "@adcode/help";

afterEach(() => setFeatureSurface("desktop"));

describe("feature surfaces", () => {
  it("marks every code-editor feature desktop-only", () => {
    for (const record of featureRecords().filter((one) => ["editing", "formatting", "navigation", "structure", "language"].includes(one.entry.group))) {
      expect(record.surface, record.entry.id).toBe("desktop");
    }
    for (const id of ["workbench.openIde", "workbench.terminal", "ai.inlineEdit", "adcode.updates.auto", "adcode.git.blame"]) {
      expect(featureFor(id)?.surface, id).toBe("desktop");
    }
  });

  it("keeps the Vibe features on both", () => {
    for (const id of ["workbench.changes", "workbench.agentsBoard", "workbench.preview", "ai.connect", "account.earnings", "adcode.git.stageCommitUi"]) {
      expect(featureFor(id)?.surface, id).toBe("both");
    }
  });

  it("on the web, offers nothing the web cannot reach - in every help surface", () => {
    setFeatureSurface("web");
    expect(featureRecords().some((record) => record.surface === "desktop")).toBe(false);
    expect(featureRecords().some((record) => record.entry.id === "workbench.changes")).toBe(true);
    expect(featureFor("adcode.editing.minimap")).toBeUndefined();
    expect(searchFeatures("minimap")).toEqual([]);
    expect(helpForGroup("editing")).toEqual([]);
    expect(searchHelp("minimap")).toEqual([]);
    expect(searchHelp("changes panel").some((entry) => entry.id === "workbench.changes")).toBe(true);
  });

  it("on the desktop, keeps everything that is not web-only", () => {
    expect(featureFor("adcode.editing.minimap")?.entry.id).toBe("adcode.editing.minimap");
    expect(featureRecords().some((record) => record.surface === "web")).toBe(false);
  });
});
