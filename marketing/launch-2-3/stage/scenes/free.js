/**
 * 15.8 – 20.6 s. Included AI, full frame.
 *
 * The one number in 2.3 worth a screen to itself: a million tokens a day, counted up in
 * money green because it is what you are not paying for. Then the real Connect a model
 * sheet - Free · no API key beside Bring your own key, Tagflow Code 27B selected, and sign
 * in with Google or GitHub.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, seg, spring, tf } from "/shared/engine.js";
import { icon, words } from "../kit.js";

export const free = {
  id: "free",
  from: CUE.free,
  to: CUE.back + 0.05,
  mount(root) {
    this.count = h("div", { class: "free-count", text: "0" });
    this.label = h("div", { class: "free-label" }, words("tokens of AI, every day."));
    this.word = h("div", { class: "free-word" }, h("span", { class: "word money", text: "Free." }), " ", ...words("No API key."));
    const logo = (letter) => h("span", { class: "connect-logo", text: letter });
    this.signIn = h("div", { class: "connect-signin" },
      h("span", {}, h("b", { text: "G" }), h("span", { text: "Continue with Google" })),
      h("span", {}, icon("git", 18), h("span", { text: "Continue with GitHub" })));
    this.connect = h("div", { class: "connect" },
      h("div", { class: "connect-title" }, h("span", { text: "Connect a model" }), h("small", { text: "Settings · AI" })),
      h("div", { class: "connect-tabs" }, h("span", { class: "current", text: "Free · no API key" }), h("span", { text: "Bring your own key" })),
      h("div", { class: "connect-row selected" }, logo("T"),
        h("div", {}, h("b", { text: "Tagflow Code 27B" }), h("small", { text: "Included with your ADCode account · 256k context" })),
        h("span", { class: "connect-badge", text: "Selected" })),
      this.signIn);
    this.rig = h("div", { class: "free-rig" }, h("div", { class: "free-glow" }), this.count, this.label, this.word, this.connect);
    this.layer = h("div", { class: "layer" }, h("div", { class: "free-bg" }), h("div", { class: "free-grid" }), this.rig);
    root.append(this.layer);
  },
  draw(t) {
    put(this.layer, { transform: tf({ s: lerp(1, 1.03, seg(t, CUE.free, CUE.freeOut)) }) });

    const p = ease.outExpo(seg(t, CUE.count, CUE.countLand));
    const value = t >= CUE.countLand ? 1_000_000 : Math.round(1_000_000 * p / 1000) * 1000;
    this.count.textContent = value.toLocaleString("en-US");
    const land = t >= CUE.countLand ? ease.outCubic(seg(t, CUE.countLand, CUE.countLand + 0.6)) : 0;
    const shrink = ease.inOutCubic(seg(t, CUE.models, CUE.models + 0.55));
    put(this.count, { transform: tf({ s: (t >= CUE.countLand ? lerp(1.02, 1, land) : lerp(0.96, 1.02, p)) * lerp(1, 0.5, shrink), y: lerp(0, -190, shrink) }) });

    [...this.label.querySelectorAll(".word")].forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.count + 0.45 + i * 0.07, CUE.count + 0.85 + i * 0.07));
      put(word, { transform: tf({ y: lerp(40, 0, rise) }), opacity: rise * (1 - shrink) });
    });
    [...this.word.querySelectorAll(".word")].forEach((word, i) => {
      const rise = ease.outCubic(seg(t, CUE.freeWord + i * 0.12, CUE.freeWord + 0.4 + i * 0.12));
      put(word, { transform: tf({ y: lerp(40, 0, rise) }), opacity: rise });
    });
    put(this.word, { transform: tf({ y: lerp(0, -330, shrink), s: lerp(1, 0.8, shrink) }) });

    const sheet = ease.outCubic(seg(t, CUE.models + 0.15, CUE.models + 0.75));
    put(this.connect, { transform: tf({ y: lerp(520, 0, sheet), s: 1.22 }), opacity: sheet });
    const sign = ease.outCubic(seg(t, CUE.signIn, CUE.signIn + 0.4));
    put(this.signIn, { transform: tf({ y: lerp(16, 0, sign) }), opacity: sign });
  },
};
