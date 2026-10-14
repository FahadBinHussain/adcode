/*
 * The words on the web version's own screens.
 *
 * Firebase reports sign-in failures as codes like `auth/invalid-credential`; a person needs a
 * sentence that says what to do. And the daily allowance is shown as time left, with a tone
 * that turns amber at ten minutes and red at two.
 */
import { describe, expect, it } from "vitest";
import { firebaseErrorText, formatReset, formatTimeLeft, relativeTime, timeTone } from "../src/web/gateText.ts";

describe("sign-in errors", () => {
  it("says nothing when the person closed the sign-in window", () => {
    expect(firebaseErrorText("auth/popup-closed-by-user")).toBeNull();
    expect(firebaseErrorText("auth/cancelled-popup-request")).toBeNull();
  });

  it("explains the common failures in plain words", () => {
    expect(firebaseErrorText("auth/invalid-credential")).toBe("That email and password don't match.");
    expect(firebaseErrorText("auth/unauthorized-domain")).toContain("isn't set up for this address");
    expect(firebaseErrorText("auth/popup-blocked")).toContain("Allow pop-ups");
  });

  it("falls back to a plain retry for anything else, never a code", () => {
    expect(firebaseErrorText("auth/something-new")).toBe("Sign-in didn't work. Try again.");
    expect(firebaseErrorText(undefined)).toBe("Sign-in didn't work. Try again.");
  });
});

describe("time left", () => {
  it("counts minutes, then hours", () => {
    expect(formatTimeLeft(47 * 60_000 + 30_000)).toBe("47 min left today");
    expect(formatTimeLeft(60 * 60_000)).toBe("1 h left today");
    expect(formatTimeLeft(75 * 60_000)).toBe("1 h 15 min left today");
  });

  it("says when less than a minute or nothing is left", () => {
    expect(formatTimeLeft(20_000)).toBe("Less than a minute left");
    expect(formatTimeLeft(0)).toBe("No time left today");
    expect(formatTimeLeft(-5)).toBe("No time left today");
  });

  it("turns amber at ten minutes and red at two", () => {
    expect(timeTone(11 * 60_000)).toBe("ok");
    expect(timeTone(10 * 60_000)).toBe("low");
    expect(timeTone(2 * 60_000)).toBe("last");
    expect(timeTone(0)).toBe("last");
  });
});

describe("relative time", () => {
  const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
  it("reads like a person would say it", () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe("4 days ago");
  });

  it("never says a time in the future", () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe("just now");
  });
});

describe("reset time", () => {
  it("says when the allowance comes back, as a clock time", () => {
    expect(formatReset(Date.UTC(2026, 9, 15, 0, 0, 0), "en-GB")).toMatch(/^Resets at \d{2}:\d{2}$/);
  });
});
