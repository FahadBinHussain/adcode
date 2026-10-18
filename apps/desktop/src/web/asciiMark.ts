/**
 * The ADCode ribbon mark, `<$>`, drawn in ASCII - the site's login illustration
 * (`AuthAscii.tsx` / `AdcodeLoader.tsx`), with the same slow sweep of light across it.
 *
 * One source of truth for the front door's three surfaces: `seo.ts` renders the static rows
 * into the pre-JS splash at bundle time, and `gate.ts` mounts the animated canvas once
 * JavaScript is live, so the first paint and the app show the same mark, and the splash's
 * sweep becomes the app's sweep instead of cutting from one picture to another.
 *
 * The geometry is `Mark.tsx` path for path. Pure at import - the splash is built in Node,
 * where there is no canvas - so coverage is sampled from the strokes' own distances rather
 * than by stroking paths into a mask.
 */

export const MARK_COLUMNS = 72;
export const MARK_ROWS = 25;
/** Light to heavy, the login page's ramp. */
export const MARK_RAMP = ".,:;=+*#%@";

/** Cells with less coverage than this stay blank. */
const INK_FLOOR = 0.18;
/** The mask window in Mark.tsx's 1024-unit viewBox - AdcodeLoader's transform, written out. */
const WINDOW = { x: 64, y: 256, width: 896, height: 512 } as const;

type Point = readonly [number, number];

interface Stroke {
  /** Stroke width in viewBox units. */
  readonly width: number;
  /** The stroke's centre-line; the dollar is flattened from its curves. */
  readonly points: readonly Point[];
  readonly bounds: readonly [number, number, number, number];
}

/** Flatten a cubic curve into straight hops - sub-pixel at this grid's cell size. */
function flat(out: Point[], c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number, steps = 18): void {
  const [px, py] = out[out.length - 1]!;
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * px + b * c1x + c * c2x + d * x, a * py + b * c1y + c * c2y + d * y]);
  }
}

function stroke(width: number, points: readonly Point[]): Stroke {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { width, points, bounds: [minX, minY, maxX, maxY] };
}

/** The dollar's S, from the same six curves the SVG draws. */
const DOLLAR: Point[] = [[584, 405]];
flat(DOLLAR, 563, 374, 531, 356, 494, 356);
flat(DOLLAR, 446, 356, 413, 383, 413, 423);
flat(DOLLAR, 413, 463, 444, 484, 505, 500);
flat(DOLLAR, 569, 517, 606, 541, 606, 590);
flat(DOLLAR, 606, 641, 565, 671, 511, 671);
flat(DOLLAR, 466, 671, 429, 651, 405, 619);

const STROKES: readonly Stroke[] = [
  stroke(96, [[320, 348], [140, 512], [320, 676]]),
  stroke(96, [[704, 348], [884, 512], [704, 676]]),
  stroke(64, [[512, 296], [512, 388]]),
  stroke(64, [[512, 636], [512, 728]]),
  stroke(92, DOLLAR),
];

function distanceToSegment(x: number, y: number, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

export interface MarkGrain {
  readonly col: number;
  readonly row: number;
  /** How much of the cell the ribbon covers, 0 to 1. */
  readonly ink: number;
}

let cached: readonly MarkGrain[] | null = null;

/**
 * Every inked cell of the 72x25 mask: coverage sampled from the strokes' distances, the same
 * test a stroked pixel would give. Memoised - the grid never changes.
 */
export function markGrains(): readonly MarkGrain[] {
  if (cached !== null) return cached;
  const grains: MarkGrain[] = [];
  const cellWidth = WINDOW.width / MARK_COLUMNS;
  const cellHeight = WINDOW.height / MARK_ROWS;
  const probes = 4; // 4x4 subsamples per cell: sixteen coverage levels, enough for a ten-character ramp
  const reach = Math.max(cellWidth, cellHeight) / 2 + 2;
  for (let row = 0; row < MARK_ROWS; row += 1) {
    for (let col = 0; col < MARK_COLUMNS; col += 1) {
      const centreX = WINDOW.x + (col + 0.5) * cellWidth;
      const centreY = WINDOW.y + (row + 0.5) * cellHeight;
      // Cull to the strokes that could reach this cell before probing it sixteen times.
      const near = STROKES.filter((candidate) => {
        const [minX, minY, maxX, maxY] = candidate.bounds;
        const margin = candidate.width / 2 + reach;
        return centreX >= minX - margin && centreX <= maxX + margin && centreY >= minY - margin && centreY <= maxY + margin;
      });
      let covered = 0;
      for (let sy = 0; sy < probes; sy += 1) {
        for (let sx = 0; sx < probes; sx += 1) {
          const x = WINDOW.x + (col + (sx + 0.5) / probes) * cellWidth;
          const y = WINDOW.y + (row + (sy + 0.5) / probes) * cellHeight;
          const hit = near.some((candidate) => candidate.points.some((point, index) =>
            index > 0 && distanceToSegment(x, y, candidate.points[index - 1]!, point) <= candidate.width / 2));
          if (hit) covered += 1;
        }
      }
      const ink = covered / (probes * probes);
      if (ink >= INK_FLOOR) grains.push({ col, row, ink });
    }
  }
  cached = grains;
  return grains;
}

/**
 * The static rows the splash ships, at a point on the sweep: 0 is the lightest the wave gets,
 * 1 the heaviest. The stylesheet cross-fades the pair where the canvas moves its band.
 */
export function markRows(sweep: number): readonly string[] {
  const cells = Array.from({ length: MARK_ROWS }, () => Array<string>(MARK_COLUMNS).fill(" "));
  const step = 4 + sweep * 5;
  for (const grain of markGrains()) {
    const index = Math.max(0, Math.min(MARK_RAMP.length - 1, Math.floor(grain.ink * step)));
    cells[grain.row]![grain.col] = MARK_RAMP[index]!;
  }
  return cells.map((row) => row.join(""));
}

/** Paint one frame - the login art's travelling wave, with stirred grains thinning out. */
export function mountMark(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d");
  if (context === null) return () => {};
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const grains = markGrains().map((grain) => ({ ...grain, dx: 0, dy: 0, vx: 0, vy: 0 }));
  let frame = 0, last = 0, time = 0;
  let width = 1, height = 1, color = "";
  let fontSize = 1, advance = 1, artLeft = 0, artTop = 0;
  let pointer: { x: number; y: number } | null = null;

  const paint = (): void => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    for (const grain of grains) {
      const sweep = (Math.sin(grain.col * 0.09 - grain.row * 0.13 - time) + 1) / 2;
      const drift = Math.hypot(grain.dx, grain.dy);
      const char = MARK_RAMP[Math.max(0, Math.floor(grain.ink * (4 + sweep * 5)) - Math.round(drift * 1.5))]!;
      context.fillText(char, artLeft + (grain.col + grain.dx) * advance, artTop + (grain.row + grain.dy) * fontSize);
    }
  };

  const stir = (): void => {
    // Pointer to grid coordinates; distances in row units so the dent is round.
    const touching = pointer !== null;
    const px = pointer === null ? 0 : (pointer.x - artLeft) / advance;
    const py = pointer === null ? 0 : (pointer.y - artTop) / fontSize;
    const reach = 7, strength = 110, r2 = (advance / fontSize) ** 2;
    for (const grain of grains) {
      if (touching) {
        const ex = grain.col + grain.dx - px;
        const ey = grain.row + grain.dy - py;
        const d2 = ex * ex * r2 + ey * ey;
        if (d2 < reach * reach && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const push = strength * (1 - d / reach) / d * 0.05;
          grain.vx += ex * push;
          grain.vy += ey * push;
        }
      }
      // Spring home and damp until the sand settles.
      grain.vx += (-40 * grain.dx - 9 * grain.vx) * 0.05;
      grain.vy += (-40 * grain.dy - 9 * grain.vy) * 0.05;
      grain.dx += grain.vx * 0.05;
      grain.dy += grain.vy * 0.05;
    }
  };

  const stop = (): void => { cancelAnimationFrame(frame); frame = 0; last = 0; };
  const tick = (now: number): void => {
    if (!last || now - last >= 1000 / 20) {
      const elapsed = last ? Math.min(now - last, 100) : 0;
      time += elapsed * 0.0008; // the login art's sweep rate, exactly
      last = now;
      stir();
      paint();
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = (): void => {
    stop();
    if (!document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
    else paint();
  };
  const palette = (): void => { color = getComputedStyle(canvas).color; paint(); };
  const layout = (): void => {
    fontSize = Math.min(width / (MARK_COLUMNS * 0.61), height / MARK_ROWS);
    context.font = `${fontSize}px "Geist Mono", monospace`;
    context.textBaseline = "top";
    advance = context.measureText("M").width;
    artLeft = (width - advance * MARK_COLUMNS) / 2;
    artTop = (height - MARK_ROWS * fontSize) / 2;
  };
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    layout();
    palette();
  };
  const box = new ResizeObserver(resize);
  const steer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const release = (): void => { pointer = null; };
  box.observe(canvas);
  // Stirring is for a real pointer: a touch drag scrolls the page, it does not rake the sand.
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    canvas.addEventListener("pointermove", steer);
    canvas.addEventListener("pointerleave", release);
  }
  motion.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  resize();
  sync();
  return () => {
    stop();
    box.disconnect();
    motion.removeEventListener("change", sync);
    document.removeEventListener("visibilitychange", sync);
    canvas.removeEventListener("pointermove", steer);
    canvas.removeEventListener("pointerleave", release);
  };
}
