import { expect, it } from "vitest";
import { selectPageTarget } from "../../../scripts/lib/headlessEdge.mjs";

it("keeps browser sync dialogs out of the web smoke target even when they appear first", () => {
  const sync = { type: "page", url: "edge://sync-confirmation-dialog/", id: "sync" };
  const blank = { type: "page", url: "about:blank", id: "smoke" };
  const web = { type: "page", url: "http://127.0.0.1:5197/", id: "smoke" };
  expect(selectPageTarget([sync, blank])).toBe(blank);
  expect(selectPageTarget([sync, web])).toBe(web);
  expect(selectPageTarget([{ type: "page", url: "chrome://welcome/" }, sync])).toBeUndefined();
  expect(selectPageTarget([{ type: "service_worker", url: "https://example.test/" }, blank])).toBe(blank);
});
