/**
 * 0 – 4 s. The mark, "Introducing", "ADCode 2.3" - each fading up on its own, slowly,
 * with nothing else on the screen.
 */
import { TITLE } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "/shared/engine.js";
import { markParts } from "../kit.js";

export const title = {
  id: "title",
  from: 0,
  to: 4.0,
  mount(root, settings) {
    const parts = markParts();
    parts.dollar.classList.add("money");
    this.mark = h("div", { class: "title-mark" }, parts.left, parts.right, parts.dollar);
    this.intro = h("div", { class: "title-intro", text: "Introducing" });
    this.name = h("div", { class: "title-name" }, h("span", { text: "ADCode " }), h("span", { class: "ver", text: settings.version }));
    this.rig = h("div", { class: "layer title-rig" }, this.mark, this.intro, this.name);
    root.append(this.rig);
  },
  draw(t) {
    const rise = (element, at, distance = 16) => {
      const p = ease.outQuint(seg(t, at, at + 1.2));
      put(element, { opacity: p, transform: tf({ y: lerp(distance, 0, p) }), filter: p >= 1 ? "none" : `blur(${((1 - p) * 8).toFixed(2)}px)` });
    };
    rise(this.mark, 0.2, 0);
    rise(this.intro, TITLE.introducing);
    rise(this.name, TITLE.name);
    const out = ease.inOutCubic(seg(t, TITLE.out, 3.95));
    put(this.rig, { opacity: 1 - out, transform: tf({ s: lerp(1, 1.04, seg(t, 0, 4)) }) });
  },
};
