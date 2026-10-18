/**
 * A draggable divider between two regions of the workbench.
 *
 * One component for both axes, because the only real difference is which coordinate is
 * read and which direction counts as "bigger" - the sidebar grows as the pointer moves
 * right, the panel grows as it moves *up*.
 *
 * Three things this does that a `mousemove` listener would not:
 *
 *   - **Pointer capture.** Dragging quickly takes the pointer over Monaco, which is its
 *     own event-hungry surface; without capture the moves stop arriving and the divider
 *     sticks to the last place it heard about while the button is still held.
 *   - **`user-select: none` on the body for the duration.** Otherwise a drag across the
 *     editor selects text the whole way, and the user lets go holding a selection they
 *     never asked for.
 *   - **Keyboard.** A control that can only be operated by dragging is a control some
 *     people cannot operate. Arrows nudge, Home resets, and the handle is focusable.
 */

import { createFrameTask } from "../frameTask.ts";

export interface SplitterDeps {
  /** The element the user grabs. */
  readonly element: HTMLElement;
  readonly axis: "x" | "y";
  /** The size right now, in pixels - read at the start of every drag. */
  readonly current: () => number;
  /** Apply a new size. Clamping belongs to the caller, which knows the limits. */
  readonly apply: (size: number) => void;
  /** Called when a drag or a key press finishes, so the result can be persisted. */
  readonly commit: () => void;
  /** What double-click restores. */
  readonly reset: number | (() => number);
  /**
   * Which pointer direction makes the region larger.
   *
   * The sidebar grows rightwards (+1); the panel is below the editor, so it grows as the
   * pointer moves up, which is a decreasing Y (-1).
   */
  readonly sign: 1 | -1;
  readonly label: string;
}

const KEY_STEP = 16;

export function createSplitter(deps: SplitterDeps): void {
  const { element, axis } = deps;
  const resetSize = (): number => typeof deps.reset === "function" ? deps.reset() : deps.reset;

  element.classList.add("splitter");
  element.dataset["axis"] = axis;
  element.tabIndex = 0;
  element.setAttribute("role", "separator");
  element.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
  element.setAttribute("aria-label", deps.label);

  let startPointer = 0;
  let startSize = 0;
  let dragging = false;
  let pendingSize = 0;
  const paint = createFrameTask(() => deps.apply(pendingSize));

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;

    /*
     * A release the divider never heard - the window lost the pointer, or a frame under it
     * swallowed the event - would otherwise leave it pinned to the pointer, resizing as the
     * mouse travels with nothing held. The first move with no buttons down says the drag is
     * over, so it ends here and what the user last saw is what gets kept.
     */
    if (event.buttons === 0) { stop(event); return; }

    const position = axis === "x" ? event.clientX : event.clientY;
    pendingSize = startSize + (position - startPointer) * deps.sign;
    paint.schedule();
  }

  function stop(event: PointerEvent): void {
    if (!dragging) return;
    paint.flush();
    dragging = false;

    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    delete element.dataset["dragging"];
    delete document.body.dataset["resizing"];
    deps.commit();
  }

  /**
   * Did this press land on the divider itself? The `::before` gives it a wider grab area than
   * its 6px track, so the test allows for that overhang.
   */
  function onDivider(event: PointerEvent): boolean {
    const rect = element.getBoundingClientRect();
    return axis === "x"
      ? event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3
      : event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3;
  }

  element.addEventListener("pointerdown", (event) => {
    // Left button only: a right-click here should not start a drag that can only be
    // ended by pressing and releasing the left one.
    if (event.button !== 0) return;

    /*
     * A capture held over from a drag whose release was never heard - the window lost the
     * focus, or a frame took the event - would otherwise re-anchor this press, which is
     * anywhere the user happened to click, and resize from a place the divider is not.
     * Ending that drag first keeps the divider's meaning tied to its own position.
     */
    if (dragging && !onDivider(event)) { stop(event); return; }

    event.preventDefault();
    dragging = true;
    startPointer = axis === "x" ? event.clientX : event.clientY;
    startSize = deps.current();

    element.setPointerCapture(event.pointerId);
    element.dataset["dragging"] = "true";
    // Suppresses selection everywhere at once; the drag crosses several surfaces.
    document.body.dataset["resizing"] = axis;
  });

  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("lostpointercapture", stop);

  element.addEventListener("dblclick", () => {
    deps.apply(resetSize());
    deps.commit();
  });

  element.addEventListener("keydown", (event) => {
    const bigger = axis === "x" ? "ArrowRight" : "ArrowUp";
    const smaller = axis === "x" ? "ArrowLeft" : "ArrowDown";

    if (event.key === bigger || event.key === smaller) {
      event.preventDefault();
      const step = event.key === bigger ? KEY_STEP : -KEY_STEP;
      // `sign` is already baked into which arrow means bigger, so it is not applied twice.
      deps.apply(deps.current() + step);
      deps.commit();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      deps.apply(resetSize());
      deps.commit();
    }
  });
}
