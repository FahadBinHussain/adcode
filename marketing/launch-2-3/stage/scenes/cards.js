/**
 * Title cards between the product shots: two short lines on black, centred, the second
 * a step quieter, each arriving on its own with a slow ease.
 */
import { CARDS } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "/shared/engine.js";

export const cards = {
  id: "cards",
  from: CARDS[0].at,
  to: CARDS[CARDS.length - 1].to,
  mount(root) {
    this.items = CARDS.map((card) => {
      const lines = card.lines.map((line, i) => h("div", { class: `card-line${i ? " dim" : ""}`, text: line }));
      const element = h("div", { class: "card" }, lines);
      return { ...card, element, lines };
    });
    root.append(...this.items.map((item) => item.element));
  },
  draw(t) {
    for (const item of this.items) {
      const live = t >= item.at && t < item.to;
      item.element.style.display = live ? "flex" : "none";
      if (!live) continue;
      const out = ease.inOutCubic(seg(t, item.to - 0.45, item.to - 0.05));
      item.lines.forEach((line, i) => {
        const start = item.at + 0.15 + i * 0.55;
        const p = ease.outQuint(seg(t, start, start + 1.1));
        put(line, { opacity: p * (1 - out), transform: tf({ y: lerp(18, 0, p) }), filter: p >= 1 ? "none" : `blur(${((1 - p) * 6).toFixed(2)}px)` });
      });
      put(item.element, { transform: tf({ s: lerp(1, 1.025, seg(t, item.at, item.to)) }) });
    }
  },
};
