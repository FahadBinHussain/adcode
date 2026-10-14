/*
 * The questions adcode-host asks the browser.
 *
 * Main-process code calls `shell.openExternal`, `dialog.showOpenDialog` and the clipboard as it
 * always has; in a sandbox each becomes a question for the tab. The one with teeth is opening a
 * link: a dev server in the sandbox reports `http://localhost:5173`, which on the person's
 * computer means nothing (or something else entirely), so loopback addresses are rewritten to
 * the sandbox's preview address before anything opens.
 */
import { describe, expect, it } from "vitest";
import { createAskHandler } from "../src/web/asks.ts";

function deps() {
  const opened: string[] = [];
  const written: string[] = [];
  return {
    opened,
    written,
    handler: createAskHandler({
      openWindow: (url) => {
        opened.push(url);
      },
      rewriteUrl: async (url) => (url.startsWith("http://localhost:") ? url.replace("http://localhost:", "https://p-") : url),
      pickFolder: async () => "/home/adcode/projects/snake",
      pickFile: async () => null,
      confirm: async (message) => (message.includes("Delete") ? 1 : 0),
      readClipboard: async () => "clip",
      writeClipboard: async (text) => {
        written.push(text);
      },
    }),
  };
}

describe("asks", () => {
  it("opens web links as they are", async () => {
    const { handler, opened } = deps();
    await handler("openExternal", { url: "https://adcode.bluethenics.com/docs" });
    expect(opened).toEqual(["https://adcode.bluethenics.com/docs"]);
  });

  it("opens a sandbox-local address at its preview address", async () => {
    const { handler, opened } = deps();
    await handler("openExternal", { url: "http://localhost:5173/" });
    expect(opened).toEqual(["https://p-5173/"]);
  });

  it("refuses to open anything that is not http or https", async () => {
    const { handler, opened } = deps();
    await handler("openExternal", { url: "javascript:alert(1)" });
    await handler("openExternal", { url: "file:///etc/passwd" });
    await handler("openExternal", { url: 42 });
    expect(opened).toEqual([]);
  });

  it("answers a folder pick with the chosen project's path", async () => {
    const { handler } = deps();
    expect(await handler("pickFolder", { title: "Open Folder" })).toEqual({ path: "/home/adcode/projects/snake" });
  });

  it("answers a cancelled file pick with no path", async () => {
    const { handler } = deps();
    expect(await handler("pickFile", {})).toEqual({ path: null });
  });

  it("maps a confirmation to the button chosen", async () => {
    const { handler } = deps();
    expect(await handler("confirm", { message: "Delete it?", buttons: ["Cancel", "Delete"] })).toEqual({ response: 1 });
  });

  it("reads and writes the clipboard through the browser", async () => {
    const { handler, written } = deps();
    expect(await handler("clipboardRead", null)).toEqual({ text: "clip" });
    await handler("clipboardWrite", { text: "copied" });
    expect(written).toEqual(["copied"]);
  });
});
