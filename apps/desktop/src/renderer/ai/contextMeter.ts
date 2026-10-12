/**
 * How full the model's context is, beside the composer.
 *
 * A long conversation used to fail without warning when it outgrew the model. The meter
 * says where it stands - "Context 34%" - and its menu is the way to make room on purpose:
 * Compact now, or read the summary the last compaction wrote. The model below is pure and
 * tested; the element at the bottom is the DOM.
 */
import type { AiContextUsageView } from "../../shared/api.ts";
import { createComposerMeter } from "./composerMeter.ts";

export interface ContextMeterModel {
  readonly percent: number;
  readonly label: string;
  readonly tone: "ok" | "warn" | "full";
  /** "About 43k of 200k tokens" - a menu heading. */
  readonly amount: string;
  readonly tooltip: string;
}

/** 950, 1.2k, 43k, 1M - how a person says a token count. */
export function formatTokens(tokens: number): string {
  const trim = (value: number): string => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}k`;
  return String(Math.max(0, Math.round(tokens)));
}

export function contextMeterModel(usage: AiContextUsageView): ContextMeterModel {
  const raw = usage.contextWindow > 0 ? (usage.tokens / usage.contextWindow) * 100 : 0;
  const percent = Math.min(100, Math.max(0, Math.round(raw)));
  const tone = percent >= usage.thresholdPercent ? "full" : percent >= usage.thresholdPercent - 15 ? "warn" : "ok";
  const amount = `About ${formatTokens(Math.max(0, usage.tokens))} of ${formatTokens(usage.contextWindow)} tokens`;
  const next = usage.autoCompact
    ? `ADCode compacts this conversation automatically at about ${String(usage.thresholdPercent)}%.`
    : "Auto-compact is off: type /compact to make room.";
  return { percent, label: `Context ${String(percent)}%`, tone, amount, tooltip: `${amount}. ${next}` };
}

/** `/compact` typed into the composer, with its optional focus; null for anything else. */
export function compactCommand(text: string): { readonly focus: string | undefined } | null {
  const match = /^\s*\/compact(?:\s+([\s\S]*?))?\s*$/.exec(text);
  if (match === null) return null;
  const focus = match[1]?.trim();
  return { focus: focus === undefined || focus.length === 0 ? undefined : focus };
}

export interface ContextMeter {
  readonly element: HTMLButtonElement;
  update(usage: AiContextUsageView): void;
}

/** The meter itself: a ring and a label. Clicking it calls `onOpen` with the button. */
export function createContextMeter(onOpen: (button: HTMLButtonElement) => void): ContextMeter {
  const meter = createComposerMeter("Context", onOpen);
  const element = meter.element;
  element.classList.add("chat-context-meter");
  element.dataset["meter"] = "context";
  element.setAttribute("aria-haspopup", "menu");
  element.setAttribute("aria-expanded", "false");

  return {
    element,
    update(usage) {
      const model = contextMeterModel(usage);
      const known = usage.contextWindow > 0 && Number.isFinite(usage.contextWindow) && Number.isFinite(usage.tokens);
      meter.update({
        percent: known ? model.percent : null,
        value: known ? `${model.percent}%` : "—",
        detail: known ? `${formatTokens(Math.max(0, usage.tokens))} / ${formatTokens(usage.contextWindow)}` : "Unknown limit",
        tooltip: known ? `${model.tooltip} Click to manage context.` : "The model's context limit is unavailable. Click to manage context.",
        tone: known ? model.tone : "unknown",
      });
    },
  };
}
