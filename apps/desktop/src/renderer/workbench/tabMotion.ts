/** Brief, interruptible tab motion. Live updates and keyboard actions stay instant. */
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
let pointerAt = -Infinity;
const running = new Set<Animation>();
document.addEventListener("pointerdown", () => { pointerAt = performance.now(); }, true);
document.addEventListener("keydown", () => { pointerAt = -Infinity; }, true);
export function tabMotionAllowed(event?: MouseEvent): boolean {
  return !reduced.matches && !document.querySelector('[data-reduced-motion="true"]')
    && (event ? event.detail > 0 : performance.now() - pointerAt < 750);
}
function stopMotion(): void { for (const animation of running) animation.cancel(); running.clear(); }
reduced.addEventListener("change", stopMotion);
new MutationObserver(() => { if (document.querySelector('[data-reduced-motion="true"]')) stopMotion(); })
  .observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-reduced-motion"] });

/** Capture existing positions before mutation; animate only new or displaced tabs. */
export function updateTabStrip(strip: HTMLElement, update: () => void, motion = false): void {
  const before = new Map<Element, DOMRect>();
  if (motion) {
    for (const child of strip.children) before.set(child, child.getBoundingClientRect());
    // Measure the visual position, then remove transforms before measuring the final layout.
    for (const child of strip.children) for (const animation of child.getAnimations()) animation.cancel();
  }
  update();
  if (!motion || !strip.getClientRects().length) return;
  for (const child of strip.children) {
    const rect = child.getBoundingClientRect();
    const old = before.get(child);
    if (!rect.width || (old && Math.abs(old.left - rect.left) < 1)) continue;
    const frames = old
      ? [{ transform: `translateX(${old.left - rect.left}px)` }, { transform: "translateX(0)" }]
      : [{ opacity: 0, transform: "translateY(4px) scale(.96)" }, { opacity: 1, transform: "translateY(0) scale(1)" }];
    const animation = child.animate(frames, { duration: old ? 160 : 200, easing: "cubic-bezier(.23,1,.32,1)" });
    running.add(animation);
    void animation.finished.then(() => running.delete(animation), () => running.delete(animation));
  }
}

/** Keep focus and existing DOM nodes intact when only labels or selection change. */
export function reconcileTabs(strip: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set(nodes);
  for (const child of [...strip.children]) if (!keep.has(child as HTMLElement)) child.remove();
  nodes.forEach((node, index) => { if (strip.children[index] !== node) strip.insertBefore(node, strip.children[index] ?? null); });
}
