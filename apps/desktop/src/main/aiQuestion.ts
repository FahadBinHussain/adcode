/**
 * The assistant asking a question, drawn in the conversation it belongs to (main/aiTools.ts
 * runs `ask_user` and waits here).
 *
 * Every open window is shown the card; the first answer from any of them settles the call,
 * which is what makes a second window a convenience rather than a race - the others are told
 * the card can go away. A dismissed card is an empty answer and not a hang: the model is
 * told nobody answered and carries on with its best judgement.
 *
 * Every way out settles exactly once - the answer, Dismiss, Stop on the turn, the last
 * window closing, and a timeout that keeps a forgotten card from holding the turn forever.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";
import {
  CHANNELS,
  type AiQuestionAnswerView,
  type AiQuestionDoneView,
  type AiQuestionItemView,
  type AiQuestionView,
} from "../shared/api.ts";
import { normalizeQuestionAnswers } from "./aiTools.ts";

/** Past this a card nobody is looking at stops being a question and becomes a hang. */
const QUESTION_TIMEOUT_MS = 15 * 60_000;

interface Pending {
  readonly questions: readonly AiQuestionItemView[];
  readonly sessionId: string;
  readonly settle: (answers: readonly AiQuestionAnswerView[] | null) => void;
}

const pending = new Map<string, Pending>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  ipcMain.on(CHANNELS.aiQuestionAnswer, (event, id: unknown, answers: unknown) => {
    const entry = typeof id === "string" ? pending.get(id) : undefined;
    if (entry === undefined) return;
    // Any window may answer - they were all shown the card - but only a real one.
    if (event.sender.isDestroyed()) return;
    entry.settle(normalizeQuestionAnswers(entry.questions, answers));
  });
}

/** The windows a fresh question goes to, or none when the app has nothing on screen. */
function liveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed());
}

export function askQuestionInWindows(
  sessionId: string,
  questions: readonly AiQuestionItemView[],
  signal?: AbortSignal,
): Promise<readonly AiQuestionAnswerView[] | null> {
  listen();
  const windows = liveWindows();
  if (windows.length === 0 || signal?.aborted === true) return Promise.resolve(null);
  const id = randomUUID();

  return new Promise<readonly AiQuestionAnswerView[] | null>((resolve) => {
    // A shared timer keeps the watchers honest when the last window closes mid-question.
    const wins = new Map(windows.map((window) => [window, (): void => {
      if (liveWindows().length > 0) return;
      finish(null);
    }]));
    const timer = setTimeout(() => finish(null), QUESTION_TIMEOUT_MS);

    function finish(answers: readonly AiQuestionAnswerView[] | null): void {
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      for (const [window, gone] of wins) window.removeListener("closed", gone);
      const done: AiQuestionDoneView = { id, sessionId, ...(answers === null ? {} : { answers }) };
      for (const window of liveWindows()) window.webContents.send(CHANNELS.aiQuestionDone, done);
      resolve(answers);
    }
    const abort = (): void => finish(null);

    pending.set(id, { questions, sessionId, settle: finish });
    signal?.addEventListener("abort", abort, { once: true });
    for (const [window, gone] of wins) window.once("closed", gone);
    const view: AiQuestionView = { id, sessionId, questions };
    for (const window of windows) window.webContents.send(CHANNELS.aiQuestion, view);
  });
}
