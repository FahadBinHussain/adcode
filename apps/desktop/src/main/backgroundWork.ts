/**
 * What lets a chat work while nobody is watching it.
 *
 * - **Awake while working.** A long task should not stop because the laptop decided the app
 *   was idle: while any chat works, the app asks the system not to suspend it. The screen may
 *   still turn off; the work carries on. Released the moment the last chat finishes.
 * - **Said when it ends unseen.** A chat that finishes while every window is in the background
 *   (minimised, behind another app) says so in a system notification; clicking it brings the
 *   app back. In the app, the chat list already shows which chats finished.
 *
 * In the cloud sandbox the electron shim makes both no-ops: there the cloud keeps a working
 * sandbox running, and the browser tab marks a chat that finished.
 */
import { BrowserWindow, Notification, powerSaveBlocker } from "electron";

let blocker: number | null = null;

export function keepAwakeWhileWorking(working: boolean): void {
  if (working && blocker === null) {
    blocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!working && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

export function announceFinishedUnseen(title: string, outcome: "finished" | "stopped" | "failed"): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0 || windows.some((window) => window.isFocused())) return;
  if (!Notification.isSupported()) return;
  const notice = new Notification({
    title: outcome === "finished" ? "Chat finished" : outcome === "failed" ? "Chat needs you" : "Chat stopped",
    body: title,
  });
  notice.on("click", () => {
    const window = windows[0];
    if (window === undefined || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  notice.show();
}
