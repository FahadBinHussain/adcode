/**
 * `ask_user`: what a model may ask, what comes back, and what the model is told when the
 * answer is nothing at all.
 *
 * The parser and the answer checker are the whole security story here - one side is model
 * output and the other arrives over IPC from a renderer - so most of this file feeds them
 * shapes they should refuse.
 */
import { describe, expect, it } from "vitest";
import type { ToolCallBlock } from "@adcode/ai";
import {
  createAiToolRunner,
  formatQuestionAnswers,
  normalizeQuestionAnswers,
  parseQuestions,
  type AiToolDeps,
} from "../src/main/aiTools.ts";

const call = (input: Record<string, unknown>): ToolCallBlock => ({ type: "tool-call", id: "call-ask", name: "ask_user", input });
const signal = (): AbortSignal => new AbortController().signal;

/** A runner with nothing but the question dependency: no workspace is ever needed. */
function asking(askUser?: AiToolDeps["askUser"]) {
  return createAiToolRunner({
    workspace: async () => null,
    memory: () => null,
    writeSandboxFile: async () => {
      throw new Error("no writes in these tests");
    },
    onProposedEdit: () => undefined,
    ...(askUser === undefined ? {} : { askUser }),
  });
}

const twoQuestions = {
  questions: [
    {
      question: "Which layout should the pricing page use?",
      header: "Layout",
      options: [
        { label: "Three cards side by side", description: "Easy to compare" },
        { label: "One wide table" },
      ],
    },
    {
      question: "What should the headline say?",
      options: [{ label: "Start free today" }, { label: "Ship with confidence" }],
      multi_select: true,
    },
  ],
};

describe("parseQuestions", () => {
  it("reads the questions, their options and their ids", () => {
    const parsed = parseQuestions(twoQuestions);
    expect(typeof parsed).toBe("object");
    expect(parsed).toEqual([
      {
        id: "q1",
        question: "Which layout should the pricing page use?",
        header: "Layout",
        options: [
          { id: "q1o1", label: "Three cards side by side", description: "Easy to compare" },
          { id: "q1o2", label: "One wide table" },
        ],
        multiSelect: false,
      },
      {
        id: "q2",
        question: "What should the headline say?",
        options: [
          { id: "q2o1", label: "Start free today" },
          { id: "q2o2", label: "Ship with confidence" },
        ],
        multiSelect: true,
      },
    ]);
  });

  it("refuses what it cannot draw, and says which part is wrong", () => {
    expect(parseQuestions({})).toMatch(/needs questions/);
    expect(parseQuestions({ questions: [] })).toMatch(/needs questions/);
    expect(parseQuestions({ questions: Array.from({ length: 5 }, () => twoQuestions.questions[0]) })).toMatch(/At most 4 questions/);
    expect(parseQuestions({ questions: [{ question: "   ", options: [{ label: "a" }] }] })).toMatch(/Question 1 needs text/);
    expect(parseQuestions({ questions: [{ question: "Which?", options: [] }] })).toMatch(/Question 1 needs options/);
    expect(parseQuestions({ questions: [{ question: "Which?", options: Array.from({ length: 5 }, () => ({ label: "a" })) }] })).toMatch(/offers 5 options/);
    expect(parseQuestions({ questions: [{ question: "Which?", options: [{ label: "  " }] }] })).toMatch(/option 1 needs a short label/);
  });

  it("keeps a long header from becoming the card's title", () => {
    const parsed = parseQuestions({ questions: [{ question: "Which?", header: "H".repeat(200), options: [{ label: "a" }] }] });
    expect(parsed).toMatchObject([{ header: "H".repeat(60) }]);
  });
});

describe("normalizeQuestionAnswers", () => {
  const questions = parseQuestions(twoQuestions);
  if (typeof questions === "string") throw new Error("the fixture must parse");

  it("keeps the picks and the user's own words, in the questions' order", () => {
    expect(normalizeQuestionAnswers(questions, [
      { questionId: "q2", optionIds: ["q2o1", "q2o2"], text: "  and keep it short  " },
      { questionId: "q1", optionIds: ["q1o2"], text: "" },
    ])).toEqual([
      { questionId: "q1", optionIds: ["q1o2"], text: "" },
      { questionId: "q2", optionIds: ["q2o1", "q2o2"], text: "and keep it short" },
    ]);
  });

  it("drops ids and fields the card never showed", () => {
    const answers = normalizeQuestionAnswers(questions, [
      { questionId: "q9", optionIds: ["q9o1"], text: "not a question" },
      { questionId: "q1", optionIds: ["q1o1", "q2o1", "q1o1"], text: 42 },
    ]);
    expect(answers).toEqual([
      { questionId: "q1", optionIds: ["q1o1"], text: "" },
      { questionId: "q2", optionIds: [], text: "" },
    ]);
  });

  it("keeps a single choice to one option, and clips what a renderer might send", () => {
    const [first] = normalizeQuestionAnswers(questions, [{ questionId: "q1", optionIds: ["q1o1", "q1o2"], text: "x".repeat(5_000) }]) ?? [];
    expect(first).toEqual({ questionId: "q1", optionIds: ["q1o1"], text: "" });
    const [, second] = normalizeQuestionAnswers(questions, [{ questionId: "q2", optionIds: ["q2o1", "q2o2"], text: "y".repeat(5_000) }]) ?? [];
    expect(second?.optionIds).toEqual(["q2o1", "q2o2"]);
    expect(second?.text.length).toBe(2_000);
  });

  it("reads an empty answer, or nothing usable, as a dismissal", () => {
    expect(normalizeQuestionAnswers(questions, [])).toBeNull();
    expect(normalizeQuestionAnswers(questions, [{ questionId: "q1", optionIds: [], text: "   " }])).toBeNull();
    expect(normalizeQuestionAnswers(questions, "everything")).toBeNull();
    expect(normalizeQuestionAnswers(questions, [{ questionId: "nope", optionIds: ["q1o1"], text: "" }])).toBeNull();
  });
});

describe("formatQuestionAnswers", () => {
  const questions = parseQuestions(twoQuestions);
  if (typeof questions === "string") throw new Error("the fixture must parse");

  it("hands the model the labels it offered, not the ids", () => {
    const text = formatQuestionAnswers(questions, [
      { questionId: "q1", optionIds: ["q1o1"], text: "" },
      { questionId: "q2", optionIds: ["q2o1"], text: "Make it a question" },
    ]);
    expect(text).toContain('- Layout -> "Three cards side by side"');
    expect(text).toContain('- What should the headline say? -> "Start free today"; their own words: "Make it a question"');
    expect(text).toContain("do not ask again");
  });

  it("tells the model a dismissed card is not a question to ask twice", () => {
    const text = formatQuestionAnswers(questions, null);
    expect(text).toMatch(/dismissed the question card/);
    expect(text).toMatch(/best judgement/);
  });
});

describe("the ask_user tool", () => {
  it("shows the questions and reports the answer", async () => {
    const seen: string[][] = [];
    const runner = asking(async (questions) => {
      seen.push(questions.map((question) => question.question));
      return [
        { questionId: "q1", optionIds: ["q1o2"], text: "" },
        { questionId: "q2", optionIds: ["q2o2"], text: "" },
      ];
    });
    const result = await runner.run(call(twoQuestions), signal());
    expect(result.isError).toBe(false);
    expect(seen).toEqual([["Which layout should the pricing page use?", "What should the headline say?"]]);
    expect(result.content).toContain('Layout -> "One wide table"');
    expect(result.content).toContain('What should the headline say? -> "Ship with confidence"');
  });

  it("carries a dismissal through as an answer, not a failure", async () => {
    const runner = asking(async () => null);
    const result = await runner.run(call(twoQuestions), signal());
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/dismissed the question card/);
  });

  it("fails the call when the input cannot be drawn, without asking anything", async () => {
    let asked = 0;
    const runner = asking(async () => {
      asked += 1;
      return null;
    });
    const result = await runner.run(call({ questions: [] }), signal());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/needs questions/);
    expect(asked).toBe(0);
  });

  it("tells an agent with nobody to ask to say it in its reply", async () => {
    const result = await asking().run(call(twoQuestions), signal());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/cannot show the user a question card/);
  });
});
