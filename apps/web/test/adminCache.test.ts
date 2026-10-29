import { describe, expect, it } from "vitest";
import { ago, readCached, writeCached } from "../src/lib/adminCache";

describe("instant admin figures", () => {
  it("says how old what is shown is, in words", () => {
    const now = 1_800_000_000_000;
    expect(ago(now - 2_000, now)).toBe("just now");
    expect(ago(now - 12_000, now)).toBe("12 seconds ago");
    expect(ago(now - 60_000, now)).toBe("1 minute ago");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(ago(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(ago(now + 5_000, now)).toBe("just now");
  });
  it("keeps the last answer per page, and survives broken or blocked storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    writeCached("overview", { revenue: "1200000" }, 42, storage);
    expect(readCached("overview", storage)).toEqual({ value: { revenue: "1200000" }, at: 42 });
    expect(readCached("missing", storage)).toBeNull();
    store.set("adcode.admin.cache.v1:broken", "{not json");
    expect(readCached("broken", storage)).toBeNull();
    expect(() => writeCached("full", 1, 1, { setItem: () => { throw new Error("quota"); } })).not.toThrow();
    expect(readCached("x", { getItem: () => { throw new Error("blocked"); } })).toBeNull();
  });
});
