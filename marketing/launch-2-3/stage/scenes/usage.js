/**
 * 26 – 30 s. AI usage: a year of building on one page.
 *
 * The 2.3 usage view - account totals, current and longest streaks, active days, and the
 * yearly activity calendar in the app's own success-green levels. The calendar fills in
 * a wave from January to today; the streak ends on today's cell.
 */
import { CUE } from "../cues.js";
import { ease, h, lerp, put, rng, seg, spring, tf } from "/shared/engine.js";
import { icon } from "../kit.js";

const WEEKS = 53;
const TODAY = { week: 52, day: 1 };
const MONTHS = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];

export const usage = {
  id: "usage",
  from: CUE.usage - 0.1,
  to: 29.8,
  mount(root) {
    const random = rng(23);
    this.cells = [];
    const cal = h("div", { class: "cal" });
    for (let week = 0; week < WEEKS; week += 1) {
      for (let day = 0; day < 7; day += 1) {
        const future = week === TODAY.week && day > TODAY.day;
        const index = week * 7 + day;
        const todayIndex = TODAY.week * 7 + TODAY.day;
        const recent = todayIndex - index;
        // Busier as the year goes on; an unbroken run of twelve days up to today.
        const busy = 0.18 + 0.6 * (week / WEEKS);
        let level = random() < busy ? 1 + Math.floor(random() * 4 * Math.min(1, busy + 0.2)) : 0;
        if (recent >= 0 && recent < 12) level = Math.max(2, Math.min(4, level + 1));
        if (recent === 12) level = 0;
        const cell = h("i", { "data-level": future ? undefined : String(Math.min(4, level)) });
        if (future) cell.style.visibility = "hidden";
        cal.append(cell);
        this.cells.push({ cell, week, day, today: recent === 0 });
      }
    }
    this.counters = [
      { label: "Tokens this year", value: 96_400_000, format: (v) => `${(v / 1e6).toFixed(1)}M` },
      { label: "Current streak", value: 12, format: (v) => `${Math.round(v)}`, unit: " days", flame: true },
      { label: "Longest streak", value: 41, format: (v) => `${Math.round(v)}`, unit: " days" },
      { label: "Active days", value: 168, format: (v) => `${Math.round(v)}`, unit: " of 365" },
    ].map((counter) => {
      const value = h("b");
      const tile = h("div", { class: "tile" }, h("small", { text: counter.label }), value,
        counter.flame ? h("span", { class: "flame" }, icon("flame", 26)) : null);
      return { ...counter, tile, valueElement: value };
    });
    this.dialog = h("div", { class: "usage" },
      h("div", { class: "usage-title" }, h("b", { text: "AI usage" }), h("small", { text: "Included AI · local history · this device" })),
      h("div", { class: "usage-tiles" }, this.counters.map((c) => c.tile)),
      h("div", { class: "cal-months" }, MONTHS.map((m, i) => h("span", { text: m, style: { gridColumn: `${2 + Math.round(i * 4.35)} / span 3` } }))),
      cal,
      h("div", { class: "cal-legend" }, h("span", { text: "Less" }), [0, 1, 2, 3, 4].map((level) => h("i", { "data-level": String(level) })), h("span", { text: "More" })));
    this.ring = h("div", { style: { position: "absolute", width: "30px", height: "30px", borderRadius: "8px", border: "2px solid #ebe8e1", left: "0", top: "0" } });
    this.dialog.append(this.ring);
    this.rig = h("div", { class: "layer" }, h("div", { class: "glow" }), h("div", { style: { position: "absolute", left: "340px", top: "170px" } }, this.dialog));
    root.append(h("div", { class: "free-bg" }), this.rig);
  },
  draw(t) {
    put(this.dialog, { transform: tf({ s: lerp(1, 1.04, seg(t, CUE.usage, 29.7)) }), transformOrigin: "50% 50%" });

    const wave = lerp(-3, WEEKS + 3, ease.inOutCubic(seg(t, CUE.calendar, CUE.calendar + 1.4)));
    for (const { cell, week, day, today } of this.cells) {
      const since = wave - week - day * 0.15;
      const pop = since > 0 ? spring(since * 0.25, 260, 14) : 0;
      put(cell, { transform: `scale(${lerp(0.2, 1, pop).toFixed(3)})`, opacity: since > 0 ? 1 : 0 });
      if (today && !this.todayCell) this.todayCell = cell;
    }
    // A ring finds today once the wave arrives.
    const ring = ease.outBack(seg(t, CUE.calendar + 1.45, CUE.calendar + 1.85));
    if (this.todayCell) {
      put(this.ring, { left: `${this.todayCell.offsetLeft - 6}px`, top: `${this.todayCell.offsetTop - 6}px`, opacity: seg(t, CUE.calendar + 1.45, CUE.calendar + 1.6), transform: tf({ s: lerp(2.2, 1, ring) }) });
    }

    this.counters.forEach((counter, i) => {
      const p = ease.outExpo(seg(t, CUE.stats + i * 0.12, CUE.stats + 0.9 + i * 0.12));
      counter.valueElement.replaceChildren(counter.format(counter.value * p), counter.unit ? h("em", { text: counter.unit }) : "");
      const enter = ease.outCubic(seg(t, CUE.usage + 0.2 + i * 0.06, CUE.usage + 0.6 + i * 0.06));
      put(counter.tile, { opacity: enter, transform: tf({ y: lerp(20, 0, enter) }) });
    });
  },
};
