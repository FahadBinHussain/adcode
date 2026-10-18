import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("asks the user question by question: picks, typing, paging, dismissal and the record left behind", () => {
  const env = { ...process.env }; delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [resolve(import.meta.dirname, "fixtures/chatQuestion.cjs")], { env, encoding: "utf8", timeout: 45_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = /^CHAT_QUESTION_RESULTS=(.+)$/m.exec(run.stdout);
  expect(line, run.stdout).not.toBeNull();
  expect(JSON.parse(line![1]!)).toEqual({
    startsBlank: true, collapses: true, expands: true, pickedEnablesNext: true, typingClearsPick: true, pickingClearsTyping: true,
    ctrlEnterAdvances: true, checkboxesKeepBoth: true, answerSent: true, sentLocks: true, answeredRecord: true,
    waitsUnseen: true, waitsUntilOpened: true, dismissSendsNothing: true, dismissedRecord: true,
    noHeader: true, buttonSubmits: true, optionRecord: true, errors: [],
  });
}, 50_000);
