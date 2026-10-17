"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * The ADCode ribbon mark in ASCII - the same picture as the login page, with
 * the same slow sweep of light running across its characters.
 *
 * The loading companion to AuthAscii.tsx on the sign-in card: the identical
 * ribbon geometry (Mark.tsx, path for path), the identical character ramp,
 * and the identical travelling wave of density, so the loader is the login
 * illustration in motion. Hovering stirs the characters like sand: grains
 * scatter under the pointer and settle back once it moves on. Theme colour,
 * hidden tabs, and reduced motion behave as they do on the login page.
 */
export function AdcodeLoader({
  label = "Loading",
  size = 120,
  fill = false,
  className,
  style,
}: {
  label?: string;
  size?: number;
  /** Stretch to a page area and centre the mark in it, for route-level loading states. */
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const columns = 72, rows = 25;
    const ramp = ".,:;=+*#%@";
    let frame = 0, last = 0, visible = false, time = 0;
    let width = 1, height = 1, color = "";
    let fontSize = 1, advance = 1, artLeft = 0, artTop = 0;
    let pointer: { x: number; y: number } | null = null;

    // Sample the same ribbon geometry as Mark.tsx and AuthAscii.tsx once,
    // rather than approximating the identity with a font's <, $, and > glyphs.
    const mask = document.createElement("canvas");
    mask.width = columns; mask.height = rows;
    const ink = mask.getContext("2d");
    if (!ink) return;
    ink.setTransform(columns / 896, 0, 0, rows / 512, -64 * columns / 896, -256 * rows / 512);
    ink.strokeStyle = "#fff";
    ink.lineCap = "round"; ink.lineJoin = "round";
    for (const [path, weight] of [
      ["M320 348L140 512L320 676", 96],
      ["M704 348L884 512L704 676", 96],
      ["M512 296V388 M512 636V728", 64],
      ["M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", 92],
    ] as const) {
      ink.lineWidth = weight;
      ink.stroke(new Path2D(path));
    }
    const pixels = ink.getImageData(0, 0, columns, rows).data;

    // Every inked cell becomes a grain with a home position, a drift offset,
    // and a velocity - all in grid units, so the pointer can stir it like sand.
    interface Grain { col: number; row: number; ink: number; dx: number; dy: number; vx: number; vy: number; }
    const grains: Grain[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const coverage = pixels[(row * columns + col) * 4 + 3]! / 255;
        if (coverage < .18) continue;
        grains.push({ col, row, ink: coverage, dx: 0, dy: 0, vx: 0, vy: 0 });
      }
    }

    const paint = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      for (const grain of grains) {
        // The login art's travelling wave, with stirred grains thinning out.
        const sweep = (Math.sin(grain.col * .09 - grain.row * .13 - time) + 1) / 2;
        const drift = Math.hypot(grain.dx, grain.dy);
        const char = ramp[Math.max(0, Math.floor(grain.ink * (4 + sweep * 5)) - Math.round(drift * 1.5))]!;
        context.fillText(char, artLeft + (grain.col + grain.dx) * advance, artTop + (grain.row + grain.dy) * fontSize);
      }
    };
    const stir = () => {
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
            const push = strength * (1 - d / reach) / d * .05;
            grain.vx += ex * push;
            grain.vy += ey * push;
          }
        }
        // Spring home and damp until the sand settles.
        grain.vx += (-40 * grain.dx - 9 * grain.vx) * .05;
        grain.vy += (-40 * grain.dy - 9 * grain.vy) * .05;
        grain.dx += grain.vx * .05;
        grain.dy += grain.vy * .05;
      }
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
    const tick = (now: number) => {
      if (!last || now - last >= 1000 / 20) {
        const elapsed = last ? Math.min(now - last, 100) : 0;
        time += elapsed * .0008;   // the login art's sweep rate, exactly
        last = now;
        stir(); paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick);
      else paint();
    };
    const palette = () => { color = getComputedStyle(canvas).color; paint(); };
    const layout = () => {
      fontSize = Math.min(width / (columns * .61), height / rows);
      context.font = `${fontSize}px monospace`;
      context.textBaseline = "top";
      advance = context.measureText("M").width;
      artLeft = (width - advance * columns) / 2;
      artTop = (height - rows * fontSize) / 2;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      layout();
      palette();
    };
    const box = new ResizeObserver(resize);
    const view = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting === true; sync(); });
    const theme = new MutationObserver(palette);
    box.observe(canvas); view.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const steer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const release = () => { pointer = null; };
    motion.addEventListener("change", sync); scheme.addEventListener("change", palette);
    document.addEventListener("visibilitychange", sync);
    canvas.addEventListener("pointermove", steer); canvas.addEventListener("pointerleave", release);
    resize(); sync();
    return () => {
      stop(); box.disconnect(); view.disconnect(); theme.disconnect();
      motion.removeEventListener("change", sync); scheme.removeEventListener("change", palette);
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("pointermove", steer); canvas.removeEventListener("pointerleave", release);
    };
  }, []);

  // Green on account surfaces, the page accent anywhere else.
  const accent = "var(--auth-accent, var(--accent))";

  return (
    <div
      className={className}
      role="status"
      style={{
        display: "grid", justifyItems: "center", alignContent: "center", gap: 12, margin: "0 auto",
        padding: fill ? "48px 0" : "18px 0", minHeight: fill ? "50svh" : undefined,
        width: "min(100%, 520px)",
        color: accent, fontFamily: "var(--font-mono), monospace",
        ...style,
      }}
    >
      <style>{`
        @keyframes adcode-loader-blink { 50% { opacity: 0; } }
        .adcode-loader-cursor { animation: adcode-loader-blink 1.1s step-end infinite; }
        @media (prefers-reduced-motion: reduce) { .adcode-loader-cursor { animation: none; } }
      `}</style>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ display: "block", width: "100%", maxWidth: 520, height: size, color: "currentColor" }}
      />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10, lineHeight: 1.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>
        {label}
        <span className="adcode-loader-cursor" aria-hidden="true" style={{ color: accent }}>▍</span>
      </span>
    </div>
  );
}
