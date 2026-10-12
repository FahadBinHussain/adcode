import { expect, it } from "vitest";
import { parseToolArguments } from "../src/providers/toolArguments.ts";

it("recovers literal control characters without changing the file text or valid escapes", () => {
  const contents = 'first\r\n\tsecond\nlast "quoted" \\n';
  const raw = JSON.stringify({ path: "a.txt", contents }).replace(/\\r/g, "\r").replace(/\\n(?=\\t|last)/g, "\n").replace(/\\t/g, "\t");
  expect(parseToolArguments(raw)).toEqual({ input: { path: "a.txt", contents }, normalized: true });
  expect(parseToolArguments(JSON.stringify({ contents }))).toEqual({ input: { contents }, normalized: false });
});
it("accepts a complete JSON fence", () => {
  expect(parseToolArguments('```json\n{"path":"a.txt","contents":"hello"}\n```')).toEqual({ input: { path: "a.txt", contents: "hello" }, normalized: true });
});
it.each(['{"path":"a","contents":"unfinished', '{"path":"a","contents":"a "quote" b"}', '{"path":"a","contents":"bad\\q"}', '{"path":"a"', 'null', '[]', '"text"', '{"path":"a"}{"path":"b"}'])("refuses to guess or complete ambiguous arguments: %s", raw => {
  expect(parseToolArguments(raw)).toBeNull();
});
