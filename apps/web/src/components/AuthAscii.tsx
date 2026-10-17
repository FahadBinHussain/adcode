"use client";

import { useEffect, useRef, useState } from "react";

/** The ADCode ribbon mark in ASCII, with a slow sweep of light across its characters. */
export function AuthAscii() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(.4);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const columns = 72, rows = 25;
    const letters = new Array<string>(columns * rows);
    const ramp = ".,:;=+*#%@";
    let frame = 0, last = 0, time = phase.current, visible = false;
    let width = 1, height = 1, color = "";

    // Sample the same ribbon geometry as Mark.tsx once, rather than approximating
    // the identity with a font's <, $, and > glyphs. The crop preserves its proportions.
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

    const paint = () => {
      letters.fill(" ");
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const index = row * columns + col;
          const coverage = pixels[index * 4 + 3]! / 255;
          if (coverage < .18) continue;
          const sweep = (Math.sin(col * .09 - row * .13 - time) + 1) / 2;
          letters[index] = ramp[Math.min(ramp.length - 1, Math.floor(coverage * (4 + sweep * 5)))]!;
        }
      }
      context.clearRect(0, 0, width, height);
      const fontSize = Math.min(width / (columns * .61), height / rows);
      context.font = `${fontSize}px monospace`;
      context.textBaseline = "top";
      context.fillStyle = color;
      const left = (width - context.measureText("M").width * columns) / 2;
      const top = (height - rows * fontSize) / 2;
      for (let row = 0; row < rows; row++) {
        context.fillText(letters.slice(row * columns, (row + 1) * columns).join(""), left, top + row * fontSize);
      }
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
    const tick = (now: number) => {
      if (!last || now - last >= 1000 / 15) {
        time += Math.min(last ? now - last : 0, 100) * .0008;
        phase.current = time;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      setReduced(motion.matches);
      if (visible && !document.hidden && !paused && !motion.matches) frame = requestAnimationFrame(tick);
      else paint();
    };
    const palette = () => { color = getComputedStyle(canvas).color; paint(); };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      palette();
    };
    const size = new ResizeObserver(resize);
    const view = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting === true; sync(); });
    const theme = new MutationObserver(palette);
    size.observe(canvas); view.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    motion.addEventListener("change", sync); scheme.addEventListener("change", palette);
    document.addEventListener("visibilitychange", sync);
    resize(); sync();
    return () => {
      stop(); size.disconnect(); view.disconnect(); theme.disconnect();
      motion.removeEventListener("change", sync); scheme.removeEventListener("change", palette);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [paused]);

  return <div className="auth-art">
    <div className="auth-art-top"><span aria-hidden="true">[ &lt;$&gt; ]</span><span>Ideas in motion</span></div>
    <canvas ref={canvasRef} className="auth-ascii" aria-hidden="true" />
    <div className="auth-art-bottom"><span><i aria-hidden="true" /> ASCII / {paused || reduced ? "STILL" : "LIVE"}</span>
      <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={paused ? "Play ASCII animation" : "Pause ASCII animation"} aria-pressed={paused || reduced}>
        {reduced ? "Motion reduced" : paused ? "Play ↗" : "Pause Ⅱ"}
      </button>
    </div>
  </div>;
}
