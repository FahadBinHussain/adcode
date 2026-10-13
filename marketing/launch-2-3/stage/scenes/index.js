/**
 * The film, in running order. Later scenes draw on top of earlier ones.
 *
 * Product scenes are written in their own continuous scene time; `segmented` plays the
 * stretches SEGMENTS picks at the film times it names, hidden in between, with a slow
 * fade at every edge.
 */
import { SEGMENTS } from "../cues.js";
import { ease, lerp, seg } from "/shared/engine.js";
import { cards } from "./cards.js";
import { chat } from "./chat.js";
import { end } from "./end.js";
import { free } from "./free.js";
import { title } from "./title.js";
import { usage } from "./usage.js";

const FADE = 0.45;

function segmented(scene) {
  const segments = SEGMENTS[scene.id];
  return {
    id: scene.id,
    from: segments[0].at,
    to: segments[segments.length - 1].to,
    mount(root, settings) {
      this.root = root;
      scene.mount(root, settings);
    },
    draw(t) {
      const s = segments.find((x) => t >= x.at && t < x.to);
      if (!s) { this.root.style.opacity = "0"; return; }
      const fade = Math.min(ease.inOutCubic(seg(t, s.at, s.at + FADE)), 1 - ease.inOutCubic(seg(t, s.to - FADE, s.to)));
      this.root.style.opacity = String(fade.toFixed(4));
      scene.draw(lerp(s.from, s.until, (t - s.at) / (s.to - s.at)));
    },
  };
}

export const SCENES = [title, segmented(chat), segmented(free), segmented(usage), cards, end];
