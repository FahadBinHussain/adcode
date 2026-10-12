import type { UsageActivityView } from "../../shared/usageActivity.ts";
import { el } from "../dialogs/formDialog.ts";

/** A year of real requests, with one keyboard stop and inspectable daily counts. */
export function createUsageActivity(view: UsageActivityView, position: { day?: string; scrollLeft?: number } = {}): HTMLElement {
  const section = el("section", "usage-activity");
  section.setAttribute("aria-label", "AI activity in the past year");
  const heading = el("div", "usage-section-heading");
  heading.append(el("h3", "", "Activity"), el("span", "usage-note", "Past year"));
  const stats = el("div", "usage-activity-stats");
  const daysText = (count: number): string => `${count} ${count === 1 ? "day" : "days"}`;
  for (const [label, value] of [["Current streak", daysText(view.currentStreak)], ["Longest streak", daysText(view.longestStreak)], ["Active days", view.activeDays.toLocaleString()]]) {
    const stat = el("div", "");
    stat.append(el("span", "usage-stat-label", label), el("strong", "usage-stat-value", value));
    stats.append(stat);
  }
  section.append(heading, stats);
  const scroll = el("div", "usage-calendar-scroll");
  const calendar = el("div", "usage-calendar");
  const months = el("div", "usage-calendar-months");
  months.setAttribute("aria-hidden", "true");
  const cells = el("div", "usage-calendar-cells");
  cells.setAttribute("role", "group");
  cells.setAttribute("aria-label", "Daily AI requests. Use arrow keys to inspect days.");
  const detail = el("p", "usage-calendar-detail");
  detail.setAttribute("role", "status");
  const first = view.days[0]!;
  const padding = new Date(`${first.day}T00:00:00Z`).getUTCDay();
  const weeks = Math.ceil((padding + view.days.length) / 7);
  calendar.style.setProperty("--activity-weeks", String(weeks));
  const max = Math.max(1, ...view.days.map((day) => day.requests));
  const buttons: HTMLButtonElement[] = [];
  const selected = view.days.findIndex((day) => day.day === position.day);
  let active = selected < 0 ? view.days.length - 1 : selected;
  let month = "";
  for (let index = 0; index < padding; index += 1) cells.append(el("span", "usage-calendar-pad"));
  view.days.forEach((day, index) => {
    const date = new Date(`${day.day}T00:00:00Z`);
    const monthKey = day.day.slice(0, 7);
    if (monthKey !== month) {
      const label = el("span", "", date.toLocaleDateString([], { month: "short", timeZone: "UTC" }));
      label.style.gridColumn = String(Math.floor((padding + index) / 7) + 1);
      months.append(label);
      month = monthKey;
    }
    const cell = el("button", "usage-calendar-cell");
    cell.type = "button";
    const level = day.requests === 0 ? 0 : Math.max(1, Math.ceil(day.requests / max * 4));
    cell.dataset["level"] = String(level);
    cell.dataset["day"] = day.day;
    const label = `${date.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}: ${day.requests.toLocaleString()} AI ${day.requests === 1 ? "request" : "requests"}, ${day.tokens.toLocaleString()} tokens`;
    cell.setAttribute("aria-label", label);
    cell.title = label;
    cell.tabIndex = index === active ? 0 : -1;
    const inspect = (): void => { detail.textContent = label; };
    cell.addEventListener("mouseenter", inspect);
    cell.addEventListener("click", inspect);
    cell.addEventListener("focus", () => {
      buttons[active]!.tabIndex = -1;
      active = index;
      cell.tabIndex = 0;
      inspect();
    });
    cell.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowLeft" ? -7 : event.key === "ArrowRight" ? 7 : event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : event.key === "PageUp" ? -28 : event.key === "PageDown" ? 28 : null;
      const next = delta !== null ? index + delta : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      buttons[Math.min(buttons.length - 1, Math.max(0, next))]!.focus();
    });
    buttons.push(cell);
    cells.append(cell);
  });
  for (let index = padding + view.days.length; index < weeks * 7; index += 1) cells.append(el("span", "usage-calendar-pad"));
  detail.textContent = buttons[active]!.getAttribute("aria-label");
  calendar.append(months, cells);
  scroll.append(calendar);
  const legend = el("div", "usage-calendar-legend");
  legend.setAttribute("aria-hidden", "true");
  legend.append(el("span", "", "Fewer"));
  for (let level = 0; level <= 4; level += 1) {
    const sample = el("span", "usage-calendar-cell");
    sample.dataset["level"] = String(level);
    legend.append(sample);
  }
  legend.append(el("span", "", "More requests"));
  section.append(scroll, detail, legend, el("p", "usage-note", "Days with AI requests on this computer. Streaks use local calendar days; today stays open until midnight."));
  // Keep recent days visible on narrow windows without animating or stealing focus.
  requestAnimationFrame(() => { scroll.scrollLeft = position.scrollLeft ?? scroll.scrollWidth; });
  return section;
}
