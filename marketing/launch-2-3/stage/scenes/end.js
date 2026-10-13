/**
 * 37 – 44 s. The end card, calm: the mark with its $ in green, "ADCode 2.3", the line,
 * where to get it, and the five starter agents. Then black.
 */
import { END } from "../cues.js";
import { ease, h, lerp, put, seg, tf } from "/shared/engine.js";
import { icon, markParts, mascot } from "../kit.js";

const STARTERS = [["hexagon", "violet"], ["capsule", "green"], ["cloud", "pink"], ["drop", "coral"], ["egg", "amber"]];

export const end = {
  id: "end",
  from: END.from,
  to: 44.1,
  mount(root, settings) {
    const parts = markParts();
    parts.dollar.classList.add("money");
    this.mark = h("div", { class: "end-mark" }, parts.left, parts.right, parts.dollar);
    this.name = h("div", { class: "end-name" }, h("span", { text: "ADCode " }), h("span", { class: "ver", text: settings.version }));
    this.line = h("div", { class: "end-line" }, h("span", { text: "Agents in the chat. " }), h("span", { class: "money", text: "Free" }), h("span", { text: " AI included." }));
    this.where = h("div", { class: "end-where" }, h("span", { text: "Available now for Windows and Linux" }), h("span", { class: "end-url" }, icon("download", 22), h("span", { text: settings.url })));
    this.mascots = STARTERS.map(([shape, color]) => { const m = mascot(shape, color, 44); m.setMood("happy"); return m; });
    this.row = h("div", { class: "end-mascots" }, this.mascots.map((m) => m.element));
    this.fade = h("div", { class: "end-fade" });
    this.rig = h("div", { class: "layer" }, this.mark, this.name, this.line, this.where, this.row);
    root.append(this.rig, this.fade);
  },
  draw(t) {
    const rise = (element, at, distance = 16) => {
      const p = ease.outQuint(seg(t, at, at + 1.3));
      put(element, { opacity: p, transform: tf({ y: lerp(distance, 0, p) }), filter: p >= 1 ? "none" : `blur(${((1 - p) * 8).toFixed(2)}px)` });
    };
    rise(this.mark, END.mark, 0);
    rise(this.name, END.name);
    rise(this.line, END.line);
    rise(this.where, END.where);
    this.mascots.forEach((m, i) => {
      const at = END.mascots + i * 0.12;
      const p = ease.outQuint(seg(t, at, at + 1));
      const bob = Math.sin((t - at) * 2 + i * 1.3) * 2 * p;
      put(m.element, { opacity: p, transform: tf({ y: lerp(14, 0, p) + bob }) });
    });
    put(this.rig, { transform: tf({ s: lerp(1, 1.03, seg(t, END.from, 44)) }) });
    put(this.fade, { opacity: ease.inOutCubic(seg(t, END.fade, 44)) });
  },
};
