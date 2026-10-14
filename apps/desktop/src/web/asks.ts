/**
 * Answers to the questions adcode-host asks the browser.
 *
 * Main-process code was written for a desktop: it opens links with `shell.openExternal`, asks for
 * a folder with `dialog.showOpenDialog`, reads the clipboard. In the sandbox each of those comes
 * to the tab as an `ask` frame, and this is where the tab answers. Everything that touches the
 * page is passed in, so the rules here are testable without a DOM.
 */
import type { AskKind } from "./wire.ts";

export interface AskDeps {
  readonly openWindow: (url: string) => void;
  /** A sandbox-local address (a dev server on localhost) becomes its public preview address. */
  readonly rewriteUrl: (url: string) => Promise<string>;
  readonly pickFolder: (title: string | null) => Promise<string | null>;
  readonly pickFile: (title: string | null) => Promise<string | null>;
  /** The index of the button chosen. */
  readonly confirm: (message: string, detail: string, buttons: readonly string[]) => Promise<number>;
  readonly readClipboard: () => Promise<string>;
  readonly writeClipboard: (text: string) => Promise<void>;
}

const field = (payload: unknown, name: string): unknown =>
  payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>)[name] : undefined;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function createAskHandler(deps: AskDeps): (kind: AskKind, payload: unknown) => Promise<unknown> {
  return async (kind, payload) => {
    switch (kind) {
      case "openExternal": {
        const url = text(field(payload, "url"));
        if (url === null) return null;
        const target = await deps.rewriteUrl(url);
        // Only web addresses: a `javascript:` or `file:` link from model output must never open.
        if (!/^https?:\/\//i.test(target)) return null;
        deps.openWindow(target);
        return null;
      }
      case "pickFolder":
        return { path: await deps.pickFolder(text(field(payload, "title"))) };
      case "pickFile":
        return { path: await deps.pickFile(text(field(payload, "title"))) };
      case "confirm": {
        const buttons = field(payload, "buttons");
        return {
          response: await deps.confirm(
            text(field(payload, "message")) ?? "",
            text(field(payload, "detail")) ?? "",
            Array.isArray(buttons) ? buttons.filter((button): button is string => typeof button === "string") : [],
          ),
        };
      }
      case "clipboardRead":
        return { text: await deps.readClipboard().catch(() => "") };
      case "clipboardWrite": {
        const value = text(field(payload, "text"));
        if (value !== null) await deps.writeClipboard(value).catch(() => undefined);
        return null;
      }
      default:
        return null;
    }
  };
}
