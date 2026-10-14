/**
 * What the web version says about its own connection and today's cloud time.
 *
 * Everything else on screen is the desktop renderer's. This adds only what a browser tab needs
 * and the desktop never does:
 *
 * - a quiet "Reconnecting…" bar while the network is away (the sandbox keeps working),
 * - full-screen pauses when the cloud has put the sandbox to sleep, today's time is spent, or
 *   the month is full - each with the one or two things a person can do next,
 * - a time-left chip, amber at ten minutes and red at two, with a toast at each.
 */
import { DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";
import { hideGate, showBlocked, showWaking, type WebSession } from "./gate.ts";
import { formatReset, formatTimeLeft, timeTone } from "./gateText.ts";
import type { HostSocket } from "./socket.ts";
import type { CloudStatus } from "./wire.ts";

const TICK_MS = 15_000;

/** Dispatched on `document` to open the Cloud workspace panel. */
export const OPEN_CLOUD_WORKSPACE_EVENT = "adcode:open-cloud-workspace";

function openDesktop(): void {
  window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener");
}

function toast(text: string, tone: "info" | "warn" = "info"): void {
  const layer = document.querySelector(".web-toasts") ?? Object.assign(document.createElement("div"), { className: "web-toasts" });
  if (layer.parentElement === null) document.body.append(layer);
  const item = document.createElement("div");
  item.className = `web-toast web-toast-${tone}`;
  item.setAttribute("role", "status");
  item.textContent = text;
  layer.append(item);
  setTimeout(() => item.classList.add("web-toast-leaving"), 6_000);
  setTimeout(() => item.remove(), 6_600);
}

export function mountStatusBar(socket: HostSocket, session: WebSession): { status: () => CloudStatus | null } {
  const bar = document.createElement("div");
  bar.className = "web-connection";
  bar.setAttribute("role", "status");
  bar.hidden = true;
  document.body.append(bar);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "web-time";
  chip.hidden = true;
  chip.title = "Cloud time left today. The desktop app has no daily limit.";
  // The Cloud workspace panel listens for this; it lives in the renderer, which owns its panels.
  chip.addEventListener("click", () => document.dispatchEvent(new CustomEvent(OPEN_CLOUD_WORKSPACE_EVENT)));
  document.body.append(chip);

  let last: CloudStatus | null = null;
  let lastAt = 0;
  let warnedLow = false;
  let warnedLast = false;

  const remaining = (): number => {
    if (last === null) return Number.POSITIVE_INFINITY;
    const running = last.state === "ready" && socket.state() === "open" ? Date.now() - lastAt : 0;
    return last.allowanceMs - last.usedMs - running;
  };

  const renderChip = (): void => {
    if (last === null || last.allowanceMs <= 0) {
      chip.hidden = true;
      return;
    }
    const left = remaining();
    chip.hidden = false;
    chip.textContent = formatTimeLeft(left);
    chip.dataset["tone"] = timeTone(left);
    if (left <= 10 * 60_000 && left > 2 * 60_000 && !warnedLow) {
      warnedLow = true;
      toast("10 minutes of cloud time left today. Your work is saved as you go.", "warn");
    }
    if (left <= 2 * 60_000 && left > 0 && !warnedLast) {
      warnedLast = true;
      toast("2 minutes left today. Download your project or push it to GitHub to keep going elsewhere.", "warn");
    }
  };

  const showPause = (): void => {
    const status = last;
    if (status?.state === "spent") {
      showBlocked(
        "That's today's cloud time",
        `${formatReset(status.resetsAt)}. Your projects are saved where you left them. The desktop app runs on your own computer, with no daily limit.`,
        [
          { label: "Get the desktop app", primary: true, run: openDesktop },
          { label: "Try again", run: () => { showWaking(); socket.resume(); } },
        ],
      );
      return;
    }
    if (status?.state === "full") {
      showBlocked(
        "The web version is full this month",
        "So many people are building that this month's cloud budget is used up. Your projects are saved. The desktop app is free and has no limit.",
        [
          { label: "Get the desktop app", primary: true, run: openDesktop },
          { label: "Try again", run: () => { showWaking(); socket.resume(); } },
        ],
      );
      return;
    }
    showBlocked(
      "Paused to save your time",
      "Your workspace sleeps when nothing is happening, so your daily cloud time isn't spent on an empty room. Everything is saved.",
      [{ label: "Resume", primary: true, run: () => { showWaking(); socket.resume(); } }],
    );
  };

  socket.onStatus((state) => {
    if (state === "reconnecting") {
      bar.textContent = "Reconnecting… your workspace keeps working";
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
    if (state === "auth-failed") {
      showBlocked("You've been signed out", "Sign in again to get back to your workspace. Everything in it is saved.", [
        { label: "Sign in", primary: true, run: () => void session.signOut() },
      ]);
    }
    if (state === "paused") showPause();
    if (state === "open" && (last === null || last.state === "ready")) hideGate();
    renderChip();
  });

  socket.onCloud((status) => {
    last = status;
    lastAt = Date.now();
    switch (status.state) {
      case "waking":
        showWaking();
        break;
      case "busy":
        showWaking("Waiting for a free sandbox…", "Everyone's building right now. You're next - this page keeps trying.");
        break;
      case "ready":
        hideGate();
        break;
      case "restarted":
        hideGate();
        toast("Your workspace restarted. Edits from the last few minutes may be missing.", "warn");
        break;
      case "sleeping":
      case "spent":
      case "full":
        if (socket.state() === "paused") showPause();
        break;
    }
    renderChip();
  });

  setInterval(renderChip, TICK_MS);
  return { status: () => last };
}
