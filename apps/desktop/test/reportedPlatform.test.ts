/*
 * Which platform the included AI is told a request came from.
 *
 * The web version's sandbox is Linux, but its people are on the web - counting them as Linux
 * desktop users would make both numbers wrong.
 */
import { describe, expect, it } from "vitest";
import { reportedPlatform } from "../src/shared/reportedPlatform.ts";

describe("reportedPlatform", () => {
  it("is the operating system on the desktop", () => {
    expect(reportedPlatform({}, "win32")).toBe("win32");
    expect(reportedPlatform({}, "linux")).toBe("linux");
  });

  it("is web inside the web version's sandbox", () => {
    expect(reportedPlatform({ ADCODE_PLATFORM: "web" }, "linux")).toBe("web");
  });
});
