/** Compact results from the bundled accessibility engine; no network service or page CDN. */
import type { AxeResults } from "axe-core";

export const AXE_RUN_SCRIPT = `axe.run(document, {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  resultTypes: ['violations', 'incomplete'], iframes: false
}).then(result => ({
  violations: result.violations.map(rule => ({ id: rule.id, impact: rule.impact, help: rule.help,
    nodes: rule.nodes.slice(0, 4).map(node => ({ target: node.target, failureSummary: node.failureSummary })),
    totalNodes: rule.nodes.length })),
  incomplete: result.incomplete.map(rule => ({ id: rule.id, help: rule.help })),
  passes: result.passes.length
}))`;

export interface AccessibilityScan {
  readonly violations: readonly { readonly id: string; readonly impact: string | null; readonly help: string; readonly nodes: readonly Pick<AxeResults["violations"][number]["nodes"][number], "target" | "failureSummary">[]; readonly totalNodes: number }[];
  readonly incomplete: readonly { readonly id: string; readonly help: string }[];
  readonly passes: number;
}

export interface MotionScan {
  readonly reduced: boolean;
  readonly active: readonly { readonly target: string; readonly duration: number | string; readonly iterations: number | string }[];
  readonly totalActive: number;
  readonly domReadyMs: number | null;
  readonly loadMs: number | null;
  readonly largeResources: readonly { readonly url: string; readonly bytes: number }[];
}

export const MOTION_SCAN_SCRIPT = `(() => {
  const active = document.getAnimations().filter(a => a.playState === 'running').map(a => {
    const t = a.effect && a.effect.getComputedTiming();
    const el = a.effect && a.effect.target;
    return { target: el && el.tagName ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : '(unknown)',
      duration: t && Number.isFinite(t.duration) ? t.duration : 'indefinite',
      iterations: t && Number.isFinite(t.iterations) ? t.iterations : 'indefinite' };
  });
  const nav = performance.getEntriesByType('navigation')[0];
  const largeResources = performance.getEntriesByType('resource').filter(r => r.encodedBodySize > 500000)
    .sort((a, b) => b.encodedBodySize - a.encodedBodySize).slice(0, 5)
    .map(r => ({ url: r.name.replace(/[?#].*$/, ''), bytes: r.encodedBodySize }));
  return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, active: active.slice(0, 8), totalActive: active.length,
    domReadyMs: nav && nav.domContentLoadedEventEnd > 0 ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null, largeResources };
})()`;

export function formatAccessibilityScan(scan: AccessibilityScan): string {
  const lines = [`Accessibility: ${scan.violations.length} rule violations; ${scan.passes} automated rules passed.`];
  for (const rule of scan.violations.slice(0, 20)) {
    lines.push(`- ${rule.impact ?? "review"}: ${rule.id} — ${rule.help} (${rule.totalNodes} elements)`);
    for (const node of rule.nodes) lines.push(`  ${node.target.join(" > ")}: ${(node.failureSummary ?? "Review this element.").replace(/\s+/g, " ").slice(0, 220)}`);
  }
  if (scan.violations.length > 20) lines.push(`Showing first 20 of ${scan.violations.length} failed rules; fix and rerun.`);
  if (scan.incomplete.length > 0) lines.push(`Needs manual review (${scan.incomplete.length} rules): ${scan.incomplete.slice(0, 10).map(rule => rule.id).join(", ")}. These are unverified, not passes.`);
  lines.push("Scan scope: current document only; embedded frames excluded. Keyboard navigation, focus order, screen-reader usability and visual quality still need review.");
  return lines.join("\n");
}

export function formatMotionScan(scan: MotionScan): string {
  const lines = [`Reduced motion: ${scan.reduced ? "emulated" : "not emulated"}. Active animations: ${scan.totalActive}.`];
  for (const animation of scan.active) lines.push(`- ${animation.target}: ${animation.duration}ms, ${animation.iterations} iterations${scan.reduced ? "; review whether this remaining motion is essential" : ""}`);
  lines.push(`Local navigation timing: DOM ready ${scan.domReadyMs ?? "unavailable"}ms; load ${scan.loadMs ?? "unavailable"}ms. Development-browser observations, not a production performance score.`);
  for (const resource of scan.largeResources) lines.push(`Large resource: ${Math.round(resource.bytes / 1024)} KB — ${resource.url}`);
  return lines.join("\n");
}
