import { describe, expect, it } from "vitest";
import { MARK_COLUMNS, MARK_RAMP, MARK_ROWS, markGrains, markRows } from "../src/web/asciiMark.ts";

describe("the front door's ASCII mark", () => {
  it("draws the ribbon on the login page's grid", () => {
    const rows = markRows(0.5);
    expect(rows).toHaveLength(MARK_ROWS);
    expect(rows.every((row) => row.length === MARK_COLUMNS)).toBe(true);
    expect(rows.join("").split("").every((char) => char === " " || MARK_RAMP.includes(char))).toBe(true);
    expect(markGrains().length).toBeGreaterThan(500);
  });

  it("keeps the same cells as the sweep passes, only heavier", () => {
    const dim = markRows(0);
    const bright = markRows(1);
    const shape = (rows: readonly string[]): string => rows.map((row) => row.replace(/[^\s]/g, "x")).join("\n");
    expect(shape(bright)).toBe(shape(dim));
    expect(bright.join("")).toContain("@");
    expect(dim.join("")).not.toContain("@");
  });
});
