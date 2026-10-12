import { expect, it } from "vitest";
import { checkpointView } from "../src/main/aiCheckpointView.ts";
it("reviews recorded text changes, counts edits and never exposes binary bytes or the root", () => {
  const view = checkpointView({ id: "cp-test", root: "private-root", createdAt: 10, undone: false, files: [
    { path: "edited.ts", before: "same\nold\n", after: "same\nnew\nextra\n" },
    { path: "new.ts", before: null, after: "created\n" },
    { path: "deleted.ts", before: "removed\n", after: null },
    { path: "asset.png", before: null, after: "private-binary", encoding: "base64" },
  ] });
  expect(view.files[0]).toMatchObject({ added: 2, removed: 1, hunks: [{ original: ["old"], replacement: ["new", "extra"] }] });
  expect(view.files[1]).toMatchObject({ created: true, added: 1, removed: 0 });
  expect(view.files[2]).toMatchObject({ deleted: true, added: 0, removed: 1 });
  expect(view.files[3]).toEqual({ path: "asset.png", created: true, deleted: false });
  expect(JSON.stringify(view)).not.toMatch(/private-root|private-binary/);
});
