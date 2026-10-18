import { createIcon, ICON } from "./icons.ts";
import { createSplitter } from "./splitter.ts";
import { reconcileTabs, tabMotionAllowed, updateTabStrip } from "./tabMotion.ts";
/** Shared review tabs without reparenting live panels or reloading preview frames. */
type TabNode = { wrap: HTMLElement; button: HTMLButtonElement; label: HTMLElement; close: HTMLButtonElement };
type Entry = { element: HTMLElement; title: () => string; close: () => void; nav: HTMLElement; tabs: Map<Entry, TabNode>; add: HTMLButtonElement };
const entries: Entry[] = [];
let active: Entry | undefined;
let openBrowser: (() => void) | undefined;
const wide = window.matchMedia("(min-width: 1200px)");
export function setWorkspaceBrowserOpener(open: () => void): void { openBrowser = open; refresh(); }
function select(entry: Entry): void { active = entry; refresh(); }
function measure(): void {
  const rect = document.getElementById("editor-area")?.getBoundingClientRect();
  if (!rect || rect.height === 0) return;
  document.body.style.setProperty("--workspace-panel-top", `${rect.top}px`);
  document.body.style.setProperty("--workspace-panel-bottom", `${Math.max(8, innerHeight - rect.bottom)}px`);
  // A window that shrank cannot fit a width it once could: re-clamp the review column.
  if (reviewWidth !== null && reviewWidth > reviewMax()) { reviewWidth = reviewMax(); paintReviewWidth(); }
}
window.addEventListener("resize", measure);

/*
 * The review column's width, and the drag that can close it.
 *
 * Docked, the review column is the workbench's third box: a strip of tabs with the panel
 * they select under it. It keeps the window's own share - 45vw, which follows the window -
 * until someone drags the edge, and their pixels after that. Dragged nearly shut and
 * released, the panel it holds closes, which is what "drag a box away" should mean.
 *
 * The width lives on the body as one variable, because the column and the conversation
 * beside it have to agree about where the boundary is - the same arrangement as the rail.
 */
const REVIEW_KEY = "adcode.workspace.review.width";
/** Narrower than this the column stops being a place to work, so a resize snaps up to it. */
const REVIEW_MIN = 320;
/** A release this narrow is a close, not a resize. */
const REVIEW_CLOSE_AT = 200;
function reviewDefault(): number { return Math.round(Math.max(REVIEW_MIN, window.innerWidth * 0.45)); }
/** Never so wide that the conversation beside it stops being usable. */
function reviewMax(): number { return Math.max(REVIEW_MIN, Math.min(window.innerWidth * 0.75, window.innerWidth - 640)); }
let reviewWidth: number | null = null;
try {
  const saved = Math.round(Number(localStorage.getItem(REVIEW_KEY)));
  if (Number.isFinite(saved) && saved > 0) reviewWidth = Math.max(REVIEW_MIN, Math.min(reviewMax(), saved));
} catch { /* Optional storage. */ }
/** The width the column comes back to: what it last was, when it was last a width. */
let reviewRestore: number | null = reviewWidth;
function paintReviewWidth(): void {
  if (reviewWidth === null) document.body.style.removeProperty("--workspace-review-width");
  else document.body.style.setProperty("--workspace-review-width", `${reviewWidth}px`);
}
paintReviewWidth();
const reviewSplitter = document.createElement("div");
reviewSplitter.id = "workspace-review-splitter";
document.body.append(reviewSplitter);
createSplitter({
  element: reviewSplitter, axis: "x", sign: -1, label: "Resize review panel", reset: reviewDefault,
  current: () => active?.element.getBoundingClientRect().width ?? reviewWidth ?? reviewDefault(),
  // Nothing at all while the pointer is down: dragging the column away is a gesture, and
  // the release decides whether it was a squeeze or a close.
  apply: (value) => { reviewWidth = Math.max(0, Math.min(reviewMax(), value)); paintReviewWidth(); },
  commit: () => {
    if (reviewWidth !== null && reviewWidth < REVIEW_MIN) {
      if (reviewWidth > REVIEW_CLOSE_AT) reviewWidth = REVIEW_MIN;
      else {
        // Dragged away: the panel closes and remembers where the column last was, so
        // Preview or Changes opens it the same width - now or after a restart.
        const closing = active;
        reviewWidth = reviewRestore;
        paintReviewWidth();
        closing?.close();
        return;
      }
    }
    // Within a rounding error of the default share: let the window have the width back.
    if (reviewWidth !== null && Math.abs(reviewWidth - reviewDefault()) <= 2) reviewWidth = null;
    reviewRestore = reviewWidth;
    paintReviewWidth();
    try {
      if (reviewWidth === null) localStorage.removeItem(REVIEW_KEY);
      else localStorage.setItem(REVIEW_KEY, String(reviewWidth));
    } catch { /* Optional storage. */ }
  },
});
function refresh(): void {
  measure();
  const shown = entries.filter(e => !e.element.hidden && !e.element.closest("dialog"));
  if (!active || !shown.includes(active)) active = shown.at(-1);
  const docked = wide.matches && document.body.dataset["workspaceMode"] === "vibe";
  document.body.classList.toggle("workspace-review-open", docked && shown.length > 0);
  // The column's edge can be dragged only while there is a column to drag: maximised it
  // fills the workbench, and there is no boundary left for the pointer to find.
  const maximised = active?.element.dataset["maximised"] === "true";
  document.body.classList.toggle("workspace-review-resizable", docked && shown.length > 0 && !maximised);
  for (const entry of entries) {
    const available = shown.includes(entry);
    entry.element.classList.toggle("workspace-panel-docked", docked && available);
    entry.element.classList.toggle("workspace-panel-inactive", docked && available && entry !== active);
    entry.element.inert = docked && available && entry !== active;
    entry.nav.hidden = !docked;
    updateTabStrip(entry.nav, () => {
      const nodes: HTMLElement[] = [];
      for (const other of entry.tabs.keys()) if (!shown.includes(other)) entry.tabs.delete(other);
      for (const other of shown) {
        let node = entry.tabs.get(other);
        if (!node) {
          const wrap = document.createElement("div"); wrap.className = "workspace-panel-tab";
          const tab = document.createElement("button"); tab.type = "button"; tab.className = "workspace-tab-select";
          const label = document.createElement("span"); label.className = "workspace-tab-label";
          const icon = other.element.id.includes("browser")
            ? "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c-4 4-4 9 0 13M8 1.5c4 4 4 9 0 13"
            : other.element.id.includes("preview") ? "M2 3h12v8H2zM5 14h6M8 11v3" : ICON.file;
          tab.append(createIcon(icon), label); tab.setAttribute("aria-controls", other.element.id);
          tab.addEventListener("click", () => { select(other); other.tabs.get(other)?.button.focus(); });
          const close = document.createElement("button"); close.type = "button"; close.className = "workspace-tab-close"; close.append(createIcon(ICON.close));
          close.addEventListener("click", () => {
            const restoreFocus = wrap.contains(document.activeElement);
            other.close(); refresh();
            if (restoreFocus) active?.tabs.get(active)?.button.focus();
          });
          wrap.append(tab, close); node = { wrap, button: tab, label, close }; entry.tabs.set(other, node);
        }
        node.label.textContent = other.title(); node.button.title = other.title();
        node.button.setAttribute("aria-pressed", String(other === active));
        node.wrap.dataset["active"] = String(other === active);
        node.close.setAttribute("aria-label", `Close ${other.title()}`); node.close.title = `Close ${other.title()}`;
        nodes.push(node.wrap);
      }
      if (openBrowser) nodes.push(entry.add);
      reconcileTabs(entry.nav, nodes);
    }, tabMotionAllowed());
  }
}
wide.addEventListener("change", refresh);
new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ["data-workspace-mode"] });
export function registerWorkspacePanel(element: HTMLElement, header: HTMLElement, title: () => string, close: () => void) {
  const nav = document.createElement("nav"); nav.className = "workspace-panel-tabs"; nav.setAttribute("aria-label", "Workspace panels");
  header.prepend(nav);
  const add = document.createElement("button"); add.type = "button"; add.className = "workspace-tab-add"; add.append(createIcon(ICON.plus));
  add.title = "Open browser"; add.setAttribute("aria-label", "Open browser"); add.addEventListener("click", () => openBrowser?.());
  const entry: Entry = { element, title, close, nav, tabs: new Map(), add }; entries.push(entry);
  const area = document.getElementById("editor-area");
  if (entries.length === 1 && area) new ResizeObserver(measure).observe(area);
  nav.addEventListener("keydown", event => {
    const buttons = [...nav.querySelectorAll<HTMLButtonElement>(".workspace-tab-select, .workspace-tab-add")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus(); }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
  });
  new MutationObserver(() => { if (!element.hidden) active = entry; refresh(); }).observe(element, { attributes: true, attributeFilter: ["hidden", "data-maximised"] });
  refresh();
  return { activate: () => select(entry), refresh };
}
