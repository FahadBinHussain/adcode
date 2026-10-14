/*
 * When a push needs GitHub connected.
 *
 * In the sandbox, a push to GitHub without a token fails the way git always words it. The web
 * version recognises those failures, offers "Connect GitHub", and tries the push once more -
 * and leaves every other failure (a rejected non-fast-forward, no remote) to the message git gave.
 */
import { describe, expect, it } from "vitest";
import { needsGitHub } from "../src/web/githubConnect.ts";

describe("needsGitHub", () => {
  it("recognises git's ways of saying it has no credentials for GitHub", () => {
    for (const message of [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/a/b.git/'",
      "remote: Permission to someone/project.git denied to x-access-token.\nfatal: unable to access 'https://github.com/someone/project.git/': The requested URL returned error: 403",
    ]) {
      expect(needsGitHub({ ok: false, message })).toBe(true);
    }
  });

  it("leaves other failures, and successes, alone", () => {
    expect(needsGitHub({ ok: false, message: "! [rejected] main -> main (fetch first)" })).toBe(false);
    expect(needsGitHub({ ok: false, message: "fatal: No configured push destination." })).toBe(false);
    expect(needsGitHub({ ok: true, message: "Pushed." })).toBe(false);
    expect(needsGitHub(null)).toBe(false);
  });
});
