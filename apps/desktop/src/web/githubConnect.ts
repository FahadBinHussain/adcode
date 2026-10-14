/**
 * "Connect GitHub" in the web version, so Commit & Push works from the sandbox.
 *
 * A push without a token fails the way git always words it; `needsGitHub` recognises that, the
 * dialog walks the person through GitHub's device flow (a code to type at github.com), and the
 * push is tried once more. The token never comes to the browser - the sandbox fetches and keeps
 * it (`host/githubConnect.ts`).
 */
import type { HostSocket } from "./socket.ts";

const NO_CREDENTIALS = /could not read Username for 'https:\/\/github\.com'|Authentication failed for 'https:\/\/github\.com|github\.com\/.*returned error: 403|Permission to .+ denied to/i;

export function needsGitHub(outcome: { ok: boolean; message?: string } | null | undefined): boolean {
  return outcome !== null && outcome !== undefined && !outcome.ok && typeof outcome.message === "string" && NO_CREDENTIALS.test(outcome.message);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Walks the person through connecting GitHub. Resolves true once the sandbox holds a token. */
export function connectGitHub(socket: HostSocket, reason = "Pushing to GitHub needs your permission once."): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = el("dialog", "web-picker web-github");
    const header = el("header", "web-picker-header");
    const close = el("button", "web-picker-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    header.append(el("h2", undefined, "Connect GitHub"), close);
    const body = el("div", "web-action-body");
    const lead = el("p", "web-gate-lead", `${reason} GitHub will show you what ADCode can do before you agree.`);
    const code = el("p", "web-github-code", "…");
    code.setAttribute("aria-live", "polite");
    const status = el("p", "web-action-status", "Getting a code from GitHub…");
    status.setAttribute("role", "status");
    body.append(lead, code, status);
    const footer = el("footer", "web-picker-footer");
    const open = el("button", "web-gate-button web-gate-primary", "Open GitHub");
    open.type = "button";
    open.disabled = true;
    const copy = el("button", "web-gate-button", "Copy code");
    copy.type = "button";
    copy.disabled = true;
    footer.append(open, copy);
    dialog.append(header, body, footer);
    document.body.append(dialog);

    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(connected);
    };
    close.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.showModal();

    void (async () => {
      try {
        const started = (await socket.op("githubStart", [])) as { userCode: string; verificationUri: string };
        code.textContent = started.userCode;
        status.textContent = "Type this code at GitHub, then come back here.";
        open.disabled = false;
        copy.disabled = false;
        open.addEventListener("click", () => window.open(started.verificationUri, "_blank", "noopener"));
        copy.addEventListener("click", () => {
          void navigator.clipboard.writeText(started.userCode).then(() => { copy.textContent = "Copied"; }, () => undefined);
        });
        const result = (await socket.op("githubFinish", [])) as { ok: true; login: string | null } | { ok: false; reason: string };
        if (settled) return;
        if (result.ok) {
          status.textContent = result.login === null ? "Connected." : `Connected as @${result.login}.`;
          setTimeout(() => finish(true), 900);
        } else {
          status.textContent = result.reason;
          open.disabled = true;
        }
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "GitHub didn't answer. Try again.";
      }
    })();
  });
}
