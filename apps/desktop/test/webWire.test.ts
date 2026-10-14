/*
 * The frames between the browser, the cloud and adcode-host.
 *
 * Electron's IPC uses structured clone, so the main process hands the renderer `Uint8Array`s
 * (image reads, live-session document updates), `Date`s and the occasional `Map`. JSON would
 * turn each of those into something else without a word, and the screen that reads them would
 * break quietly. These tests pin every type the codec promises to carry.
 */
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type ServerFrame } from "../src/web/wire.ts";

function roundTrip(value: unknown): unknown {
  const decoded = decodeFrame(encodeFrame({ t: "ret", id: 1, ok: true, value }));
  if (decoded === null || decoded.t !== "ret" || !decoded.ok) throw new Error("frame did not survive");
  return decoded.value;
}

describe("wire codec", () => {
  it("keeps bytes as bytes", () => {
    const value = roundTrip(new Uint8Array([0, 255, 7]));
    expect(value).toBeInstanceOf(Uint8Array);
    expect([...(value as Uint8Array)]).toEqual([0, 255, 7]);
  });

  it("keeps an ArrayBuffer as an ArrayBuffer", () => {
    const source = new Uint8Array([1, 2, 3]).buffer;
    const value = roundTrip(source);
    expect(value).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(value as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("keeps dates, maps and sets", () => {
    const value = roundTrip({ at: new Date(0), byName: new Map([["a", 1]]), seen: new Set(["x"]) }) as Record<string, unknown>;
    expect(value["at"]).toBeInstanceOf(Date);
    expect((value["at"] as Date).getTime()).toBe(0);
    expect(value["byName"]).toEqual(new Map([["a", 1]]));
    expect(value["seen"]).toEqual(new Set(["x"]));
  });

  it("keeps holes in arrays as undefined rather than null", () => {
    expect(roundTrip([1, undefined, 3])).toEqual([1, undefined, 3]);
  });

  it("does not mistake an ordinary object with a dollar key for a tag", () => {
    expect(roundTrip({ $u8: "not-a-tag", $$x: 1 })).toEqual({ $u8: "not-a-tag", $$x: 1 });
  });

  it("carries large byte arrays", () => {
    const big = new Uint8Array(300_000).map((_, index) => index % 251);
    const value = roundTrip(big) as Uint8Array;
    expect(value.length).toBe(300_000);
    expect(value[299_999]).toBe(299_999 % 251);
  });

  it("carries nested combinations", () => {
    const value = roundTrip({ files: [{ data: new Uint8Array([9]), when: new Date(5) }] }) as { files: { data: Uint8Array; when: Date }[] };
    expect([...value.files[0]!.data]).toEqual([9]);
    expect(value.files[0]!.when.getTime()).toBe(5);
  });
});

describe("frame validation", () => {
  it("refuses text that is not JSON", () => {
    expect(decodeFrame("{")).toBeNull();
  });

  it("refuses an unknown frame type", () => {
    expect(decodeFrame('{"t":"nope"}')).toBeNull();
  });

  it("refuses frames missing their fields", () => {
    expect(decodeFrame('{"t":"call","ch":"x"}')).toBeNull();
    expect(decodeFrame('{"t":"evt","args":[]}')).toBeNull();
  });

  it("passes a well-formed event through", () => {
    const frame: ServerFrame = { t: "evt", ch: "ai:event", args: [{ kind: "text" }] };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe("web-only host operations", () => {
  it("carries an op request and its answer", () => {
    expect(decodeFrame(encodeFrame({ t: "op", id: 3, op: "projects", args: [] }))).toEqual({ t: "op", id: 3, op: "projects", args: [] });
    expect(decodeFrame(encodeFrame({ t: "opRet", id: 3, ok: true, value: [{ name: "snake" }] }))).toEqual({ t: "opRet", id: 3, ok: true, value: [{ name: "snake" }] });
    expect(decodeFrame('{"t":"op","id":1,"args":[]}')).toBeNull();
  });
});
