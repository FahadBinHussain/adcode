/**
 * The card the assistant's questions arrive in: one question at a time, the choices it
 * offers, and always room to answer in your own words.
 *
 * Presentation only, like the other chat cards. The widget decides what an answer means and
 * asks the main process; this owns the markup, the keyboard, and what a finished card reads
 * like afterwards. A pick is reported by option id and never by label, so words the user
 * typed themselves can never be mistaken for a choice.
 *
 * Dismiss is an answer too - an empty one. The model is told nobody answered rather than
 * being left to wait for ever.
 */
import type { AiQuestionAnswerView, AiQuestionView } from "../../shared/api.ts";
import { createIcon, ICON } from "../workbench/icons.ts";

export interface QuestionCard {
  readonly element: HTMLElement;
  /** The answer went back, here or in another window: the card becomes the record of it. */
  finish(answers: readonly AiQuestionAnswerView[] | null): void;
}

/** Ctrl+Enter on a PC, Cmd+Enter on a Mac - the key alone, as the button's badge. */
const advanceHint = navigator.userAgent.includes("Mac") ? "⌘↵" : "Ctrl+↵";

interface Page {
  readonly section: HTMLElement;
  readonly options: readonly HTMLInputElement[];
  readonly input: HTMLInputElement;
  readonly hint: HTMLElement;
}

export function createQuestionCard(
  view: AiQuestionView,
  answer: (answers: readonly AiQuestionAnswerView[] | null) => void,
): QuestionCard {
  const questions = view.questions;
  const picked = new Map<string, Set<string>>(questions.map((question) => [question.id, new Set<string>()]));
  const typed = new Map<string, string>(questions.map((question) => [question.id, ""]));
  const pages = new Map<string, Page>();
  let index = 0;
  let sent = false;

  const element = document.createElement("section");
  element.className = "chat-question";
  element.setAttribute("aria-label", "A question from the assistant");

  /* ── Head: which question, how many are left, and the collapse toggle ─── */
  const head = document.createElement("div");
  head.className = "chat-question-head";
  const progress = document.createElement("span");
  progress.className = "chat-question-progress";
  progress.setAttribute("aria-hidden", "true");
  const dashes = questions.map(() => {
    const dash = document.createElement("span");
    dash.className = "chat-question-dash";
    return dash;
  });
  progress.append(...dashes);
  const count = document.createElement("span");
  count.className = "chat-question-count";
  count.setAttribute("role", "status");
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "chat-question-collapse";
  collapse.setAttribute("aria-expanded", "true");
  collapse.setAttribute("aria-label", "Collapse this question");
  collapse.title = "Collapse";
  collapse.append(createIcon(ICON.chevronDown));
  head.append(progress, count, collapse);

  /* ── Body: the questions, one on screen at a time, each with its options ─ */
  const body = document.createElement("div");
  body.className = "chat-question-body";
  for (const question of questions) {
    const section = document.createElement("div");
    section.className = "chat-question-page";

    if (question.header !== undefined) {
      const kicker = document.createElement("p");
      kicker.className = "chat-question-kicker";
      kicker.textContent = question.header;
      section.append(kicker);
    }
    const title = document.createElement("p");
    title.className = "chat-question-title";
    title.id = `chat-question-title-${view.id}-${question.id}`;
    title.textContent = question.question;
    section.append(title);
    const hint = document.createElement("p");
    hint.className = "chat-question-hint";
    section.append(hint);

    const list = document.createElement("div");
    list.className = "chat-question-options";
    list.setAttribute("role", question.multiSelect ? "group" : "radiogroup");
    list.setAttribute("aria-labelledby", title.id);
    const options: HTMLInputElement[] = [];
    for (const option of question.options) {
      const item = document.createElement("label");
      item.className = "chat-question-option";
      const input = document.createElement("input");
      input.type = question.multiSelect ? "checkbox" : "radio";
      input.name = `chat-question-${view.id}-${question.id}`;
      input.value = option.id;
      const mark = document.createElement("span");
      mark.className = "chat-question-mark";
      mark.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "chat-question-option-text";
      const label = document.createElement("span");
      label.className = "chat-question-option-label";
      label.textContent = option.label;
      text.append(label);
      if (option.description !== undefined) {
        const description = document.createElement("span");
        description.className = "chat-question-option-description";
        description.textContent = option.description;
        text.append(description);
      }
      input.addEventListener("change", () => {
        const chosen = picked.get(question.id);
        if (chosen === undefined || sent) return;
        if (input.checked) {
          chosen.add(option.id);
          // One answer means one answer: a pick replaces whatever was typed.
          if (!question.multiSelect) {
            for (const other of options) other.checked = other === input;
            typed.set(question.id, "");
            const page = pages.get(question.id);
            if (page !== undefined) page.input.value = "";
          }
        } else {
          chosen.delete(option.id);
        }
        paint();
      });
      options.push(input);
      item.append(input, mark, text);
      list.append(item);
    }

    const own = document.createElement("label");
    own.className = "chat-question-own";
    const ownLabel = document.createElement("span");
    ownLabel.className = "chat-question-own-label";
    ownLabel.textContent = question.multiSelect ? "Or add your own words" : "Or type your own answer";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-question-input";
    input.placeholder = "Type your own answer...";
    input.maxLength = 2_000;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      if (sent) return;
      typed.set(question.id, input.value);
      // Typing is a choice too: it clears the radios, never the checkboxes.
      if (!question.multiSelect && input.value.trim() !== "") {
        for (const option of options) option.checked = false;
        picked.get(question.id)?.clear();
      }
      paint();
    });
    own.append(ownLabel, input);
    section.append(list, own);
    body.append(section);
    pages.set(question.id, { section, options, input, hint });
  }

  /* ── Feet: dismiss, and on to the next question or the answer itself ───── */
  const feet = document.createElement("div");
  feet.className = "chat-question-feet";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "chat-question-dismiss";
  dismiss.textContent = "Dismiss";
  dismiss.title = "Answer nothing: the assistant carries on with its best guess";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "chat-question-next";
  const nextLabel = document.createElement("span");
  nextLabel.className = "chat-question-next-label";
  const nextKeys = document.createElement("kbd");
  nextKeys.className = "chat-question-keys";
  nextKeys.textContent = advanceHint;
  next.append(nextLabel, nextKeys);
  feet.append(dismiss, next);

  element.append(head, body, feet);

  /** Whether the question on screen has an answer - a pick, or words of the user's own. */
  const answered = (): boolean => {
    const question = questions[index];
    return question !== undefined && ((picked.get(question.id)?.size ?? 0) > 0 || (typed.get(question.id) ?? "").trim() !== "");
  };

  const paint = (): void => {
    if (!sent) count.textContent = `${index + 1} of ${questions.length} question${questions.length === 1 ? "" : "s"}`;
    for (const [position, dash] of dashes.entries()) {
      dash.dataset["state"] = position < index || sent ? "done" : position === index ? "current" : "todo";
    }
    for (const [position, question] of questions.entries()) {
      const page = pages.get(question.id);
      if (page === undefined) continue;
      page.section.hidden = position !== index;
      page.hint.textContent = question.multiSelect ? "Choose one or more, or type your own answer" : "Select one answer";
      page.input.disabled = sent;
      for (const option of page.options) option.disabled = sent;
    }
    nextLabel.textContent = index === questions.length - 1 ? "Submit" : "Next";
    next.disabled = sent || !answered();
    next.title = index === questions.length - 1 ? "Send the answers" : "Go to the next question";
    dismiss.disabled = sent;
  };

  /** Every question named, in the card's own shape - what the main process checks over. */
  const collect = (): readonly AiQuestionAnswerView[] => questions.map((question) => ({
    questionId: question.id,
    optionIds: [...(picked.get(question.id) ?? [])],
    text: (typed.get(question.id) ?? "").trim(),
  }));

  const settle = (answers: readonly AiQuestionAnswerView[] | null): void => {
    if (sent) return;
    sent = true;
    paint();
    answer(answers);
  };

  const forward = (): void => {
    if (sent || !answered()) return;
    if (index < questions.length - 1) {
      index += 1;
      paint();
      pages.get(questions[index]?.id ?? "")?.input.focus();
      return;
    }
    settle(collect());
  };

  next.addEventListener("click", forward);
  dismiss.addEventListener("click", () => settle(null));
  element.addEventListener("keydown", (event) => {
    if (sent) return;
    // Ctrl+Enter advances from anywhere in the card; plain Enter from the answer field.
    const advance = event.key === "Enter" && (event.ctrlKey || event.metaKey);
    if (advance || (event.key === "Enter" && event.target === pages.get(questions[index]?.id ?? "")?.input)) {
      event.preventDefault();
      forward();
    }
  });
  collapse.addEventListener("click", () => {
    const open = element.dataset["collapsed"] !== "true";
    element.dataset["collapsed"] = String(open);
    collapse.setAttribute("aria-expanded", String(!open));
    collapse.setAttribute("aria-label", open ? "Expand this question" : "Collapse this question");
    collapse.title = open ? "Expand" : "Collapse";
  });

  /** The card after the answer went back: what was asked, and what was chosen. */
  const finish = (answers: readonly AiQuestionAnswerView[] | null): void => {
    if (element.dataset["outcome"] !== undefined) return;
    sent = true;
    paint();
    element.dataset["outcome"] = answers === null ? "dismissed" : "answered";
    count.textContent = answers === null ? "Dismissed" : "Answered";
    const list = document.createElement("ul");
    list.className = "chat-question-answers";
    for (const question of questions) {
      const item = document.createElement("li");
      item.className = "chat-question-answer";
      const label = document.createElement("span");
      label.className = "chat-question-answer-label";
      label.textContent = question.header ?? question.question;
      const value = document.createElement("span");
      value.className = "chat-question-answer-value";
      const given = answers?.find((one) => one.questionId === question.id);
      const chosen = (given?.optionIds ?? [])
        .map((id) => question.options.find((option) => option.id === id)?.label)
        .filter((text): text is string => text !== undefined);
      if (given !== undefined && given.text !== "") chosen.push(given.text);
      value.textContent = chosen.length === 0 ? "No answer" : chosen.join(" · ");
      item.append(label, value);
      list.append(item);
    }
    body.replaceChildren(list);
    feet.remove();
  };

  paint();
  return { element, finish };
}
