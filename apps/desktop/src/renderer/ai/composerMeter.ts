/** A small, readable ring. Unknown limits have a dashed track, never a made-up percent. */
export interface ComposerMeterModel {
  readonly percent: number | null;
  readonly value: string;
  readonly detail: string;
  readonly tooltip: string;
  readonly tone: "ok" | "warn" | "full" | "unknown";
  /** Renames the meter: the included-AI pair reads "Session" and "Weekly", others keep theirs. */
  readonly label?: string;
}

export interface ComposerMeter {
  readonly element: HTMLButtonElement;
  update(model: ComposerMeterModel): void;
}

const RING = 2 * Math.PI * 15;

export function createComposerMeter(initialName: string, onOpen: (button: HTMLButtonElement) => void): ComposerMeter {
  let name = initialName;
  const element = document.createElement("button");
  element.type = "button";
  element.className = "composer-meter";
  const ring = document.createElement("span");
  ring.className = "composer-meter-ring";
  ring.setAttribute("aria-hidden", "true");
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  const track = document.createElementNS(svgNs, "circle");
  const fill = document.createElementNS(svgNs, "circle");
  for (const circle of [track, fill]) {
    circle.setAttribute("cx", "18");
    circle.setAttribute("cy", "18");
    circle.setAttribute("r", "15");
  }
  track.classList.add("composer-meter-track");
  fill.classList.add("composer-meter-fill");
  fill.setAttribute("stroke-dasharray", `${RING} ${RING}`);
  svg.append(track, fill);
  const value = document.createElement("span");
  value.className = "composer-meter-value";
  ring.append(svg, value);
  const copy = document.createElement("span");
  copy.className = "composer-meter-copy";
  const label = document.createElement("span");
  label.className = "composer-meter-label";
  label.textContent = name;
  const detail = document.createElement("span");
  detail.className = "composer-meter-detail";
  copy.append(label, detail);
  element.append(ring, copy);
  element.addEventListener("click", () => onOpen(element));
  const meter: ComposerMeter = {
    element,
    update(model) {
      const percent = model.percent === null || !Number.isFinite(model.percent) ? null : Math.min(100, Math.max(0, model.percent));
      name = model.label ?? initialName;
      label.textContent = name;
      element.dataset["tone"] = model.tone;
      element.dataset["percent"] = percent === null ? "unknown" : String(percent);
      value.textContent = model.value;
      detail.textContent = model.detail;
      element.title = model.tooltip;
      element.setAttribute("aria-label", `${name}: ${model.value}. ${model.tooltip}`);
      fill.setAttribute("stroke-dashoffset", String(RING * (1 - (percent ?? 0) / 100)));
    },
  };
  meter.update({ percent: null, value: "—", detail: "Checking…", tooltip: `Checking ${name.toLowerCase()}.`, tone: "unknown" });
  return meter;
}
