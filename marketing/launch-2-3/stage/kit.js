/**
 * What this film draws that the Payback kit does not: the agents' mascots in their real
 * colours and shading (apps/desktop/src/renderer/agents/agentMascot.ts and agents.css), the
 * composer's ring meters (ai/composerMeter.ts), and a few type helpers. The mark, icons and
 * the pointer come from the shared kit.
 */
import { h, put } from "/shared/engine.js";

export { assistantFace, icon, markInline, markParts, pointer } from "/shared/ui.js";

const BODIES = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  capsule: "M15 9h18a15 15 0 0 1 0 30H15a15 15 0 0 1 0-30z",
  pebble: "M8 23c0-10 8-17 17-17 9.5 0 16 6.5 16 16 0 11-7.5 20-17 20S8 33.5 8 23z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
  cloud: "M15 39a10 10 0 0 1-2.5-19.7A12 12 0 0 1 35.3 17 9.5 9.5 0 0 1 37 39z",
  squircle: "M24 5c15.5 0 19 3.5 19 19s-3.5 19-19 19S5 39.5 5 24 8.5 5 24 5z",
  egg: "M24 4c9.5 0 16.5 13.5 16.5 23.5a16.5 16.5 0 0 1-33 0C7.5 17.5 14.5 4 24 4z",
};

const FACES = {
  sleepy: [{ d: "M15.5 25.5q3 2.2 6 0" }, { d: "M26.5 25.5q3 2.2 6 0" }, { d: "M22 32.5h4" }],
  thinking: [{ d: "M17.5 20.5a2 2.6 0 1 1 0 .01z", fill: true }, { d: "M28.5 20.5a2 2.6 0 1 1 0 .01z", fill: true }, { d: "M21 31.5h6" }],
  alert: [{ d: "M18.5 21a2.6 3 0 1 1 0 .01z", fill: true }, { d: "M29.5 21a2.6 3 0 1 1 0 .01z", fill: true }, { d: "M24 30.5a2 2 0 1 1 0 .01z", fill: true }],
  proud: [{ d: "M15.5 25q3-3 6 0" }, { d: "M26.5 25q3-3 6 0" }, { d: "M19.5 30.5q4.5 3.5 9 0" }],
  happy: [{ d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true }, { d: "M29.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true }, { d: "M18 29.5q6 6 12 0" }],
  confused: [{ d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true }, { d: "M29.5 23a1.6 2 0 1 1 0 .01z", fill: true }, { d: "M19 32q2.5-2 5 0t5 0" }],
};

/** The dark theme's mascot colours. */
export const MASCOT_COLOR = {
  blue: "#5a92f0", teal: "#25b5a5", green: "#3fb173", lime: "#86b52a", amber: "#e09a22",
  orange: "#ef7d43", coral: "#ea6c62", pink: "#e25c9f", violet: "#9076ec", slate: "#7a8699",
};

let shadeSeq = 0;

/** A coloured, lit mascot whose face follows its run. */
export function mascot(shape, color, size) {
  shadeSeq += 1;
  const id = `shade-${shadeSeq}`;
  const gradient = h("radialGradient", { id, cx: 0.38, cy: 0.32, r: 0.78, fx: 0.32, fy: 0.24 },
    [["0", "#ffffff", "0.7"], ["0.14", "#ffffff", "0.32"], ["0.42", "#ffffff", "0"], ["0.72", "#000000", "0"], ["1", "#000000", "0.34"]]
      .map(([offset, stop, opacity]) => h("stop", { offset, "stop-color": stop, "stop-opacity": opacity })));
  const face = h("g", { class: "mascot-face" });
  const body = h("g", { class: "mascot-body-group" },
    h("path", { d: BODIES[shape], fill: MASCOT_COLOR[color] }),
    h("path", { d: BODIES[shape], fill: `url(#${id})` }),
    face);
  const svg = h("svg", { viewBox: "0 0 48 48", width: size, height: size, class: "mascot" }, h("defs", {}, gradient), body);
  let mood = null;
  return {
    element: svg,
    body,
    setMood(next) {
      if (next === mood) return;
      mood = next;
      face.replaceChildren(...FACES[next].map(({ d, fill }) => h("path", { d, class: fill ? "solid" : "line" })));
    },
  };
}

/** Words as inline-block spans, so each can rise on its own. */
export function words(text, className = "word") {
  return text.split(" ").flatMap((word, i) => [i === 0 ? null : " ", h("span", { class: className, text: word })]).filter(Boolean);
}

/** A composer meter: a ring, its value inside, a label and detail beside it. */
export function meter(label) {
  const RING = 2 * Math.PI * 15;
  const fill = h("circle", { cx: 18, cy: 18, r: 15, class: "meter-fill", "stroke-dasharray": `${RING} ${RING}`, "stroke-dashoffset": RING });
  const value = h("span", { class: "meter-value" });
  const detail = h("span", { class: "meter-detail" });
  const element = h("div", { class: "meter" },
    h("span", { class: "meter-ring" }, h("svg", { viewBox: "0 0 36 36" }, h("circle", { cx: 18, cy: 18, r: 15, class: "meter-track" }), fill), value),
    h("span", { class: "meter-copy" }, h("span", { class: "meter-label", text: label }), detail));
  return {
    element,
    update(percent, text, more, dashed = false) {
      fill.setAttribute("stroke-dashoffset", String(RING * (1 - Math.max(0, Math.min(1, percent)))));
      element.dataset.dashed = String(dashed);
      value.textContent = text;
      detail.textContent = more;
    },
  };
}

/** A tiny highlighter for the code the agents write: keywords, strings, numbers, comments. */
export function codeLine(text) {
  const parts = [];
  const pattern = /(\/\/.*$)|("[^"]*"|'[^']*'|`[^`]*`)|\b(const|let|return|export|function|import|from|if|else|new|await|async|for|of|expect|test|describe)\b|\b(\d+)\b/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const kind = match[1] ? "c" : match[2] ? "s" : match[3] ? "k" : "n";
    parts.push(h("span", { class: `tok-${kind}`, text: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Rise words in from below, one after another. */
export function riseWords(elements, t, start, step = 0.07, distance = 46, duration = 0.42, ease = (p) => 1 - (1 - p) ** 3) {
  elements.forEach((element, i) => {
    const p = ease(Math.min(1, Math.max(0, (t - start - i * step) / duration)));
    put(element, { transform: `translateY(${((1 - p) * distance).toFixed(2)}px)`, opacity: p });
  });
}
