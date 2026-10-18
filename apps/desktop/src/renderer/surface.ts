/**
 * Whether this renderer is the web version (web.bluethenics.com) rather than the desktop app.
 *
 * The web entry (`src/web/boot.ts`) marks the page before the renderer loads. The few places
 * that behave differently ask this rather than sniffing for Electron, so the desktop's
 * behaviour is the default and the web's is opt-in.
 */
export function isWebSurface(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset["surface"] === "web";
}

export const OPEN_WEB_ACCOUNT_EVENT = "adcode:open-account";
export function openWebAccount(section = "overview"): void {
  document.dispatchEvent(new CustomEvent(OPEN_WEB_ACCOUNT_EVENT, { detail: section }));
}

/** Where "Get the desktop app" goes from the web version. */
export const DESKTOP_DOWNLOAD_URL = "https://adcode.bluethenics.com/#download";
