import type { BrowserChatSummary, BrowserProposal } from "./browserTypes.ts";

/** Drafts are scoped to the authenticated account, never to an email or a shared browser. */
export function browserDraftKey(uid: string | null | undefined, chatId = "new"): string | null {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 256
    ? `adcode.browser.draft:${encodeURIComponent(uid)}:${encodeURIComponent(chatId)}` : null;
}

export function updateBrowserHistory(history: readonly BrowserChatSummary[], chat: BrowserChatSummary): BrowserChatSummary[] {
  return [chat, ...history.filter((entry) => entry.id !== chat.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 50);
}

/** A second proposal for a file replaces its earlier proposal, including a deletion. */
export function updateBrowserProposals(proposals: readonly BrowserProposal[], proposal: BrowserProposal): BrowserProposal[] {
  return [...proposals.filter((entry) => entry.path !== proposal.path), proposal];
}

export interface BrowserDiffLine { readonly kind: "context" | "removed" | "added"; readonly text: string }

/** Keep surrounding context and show the changed block without quadratic work on large files. */
export function browserFileDiff(before: string | null, after: string | null): BrowserDiffLine[] {
  const oldLines = before === null ? [] : before.split("\n");
  const newLines = after === null ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix += 1;
  return [
    ...oldLines.slice(Math.max(0, prefix - 3), prefix).map((text) => ({ kind: "context" as const, text })),
    ...oldLines.slice(prefix, oldLines.length - suffix).map((text) => ({ kind: "removed" as const, text })),
    ...newLines.slice(prefix, newLines.length - suffix).map((text) => ({ kind: "added" as const, text })),
    ...oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 3).map((text) => ({ kind: "context" as const, text })),
  ];
}

export function shouldSendBrowserMessage(event: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
