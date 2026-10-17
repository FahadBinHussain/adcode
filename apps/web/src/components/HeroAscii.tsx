"use client";

import { useEffect, useRef } from "react";

/** A bounded glyph field: no per-frame React renders or layout measurements. */
export function HeroAscii() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    let width = 0, height = 0, raf = 0, last = 0;
    let visible = false, hovering = false, slow = false;
    let targetX = 0, targetY = 0, pointerX = 0, pointerY = 0, strength = 0;
    let bounds = host.getBoundingClientRect();
    // Recycle a fixed pool only while fully faded out, avoiding visible jumps.
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(), age: -Math.random() * 4,
      life: 5 + Math.random() * 5, size: Math.random(),
    }));
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      for (const star of stars) {
        const x = 12 + star.x * Math.max(0, width - 24);
        const y = 12 + star.y * Math.max(0, height - 24);
        const dx = x - pointerX, dy = y - pointerY;
        const influence = Math.max(0, 1 - (dx * dx + dy * dy) / 22500) * strength;
        const life = Math.max(0, Math.min(1, star.age / star.life));
        const twinkle = Math.sin(life * Math.PI) ** 2;
        const alpha = reduced.matches ? .35 : twinkle * (.4 + star.size * .4);
        ctx.globalAlpha = Math.min(1, alpha + influence * .7);
        if (ctx.globalAlpha < .015) continue;
        // A subtle outward drift and brighter asterisk respond to the pointer.
        const drift = influence * 8 / Math.max(1, Math.hypot(dx, dy));
        const glyph = influence > .35 || star.size > .75 ? "*" : star.size > .4 ? "+" : ".";
        ctx.fillText(glyph, x + dx * drift, y + dy * drift);
      }
      ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || reduced.matches) return;
      const elapsed = last ? now - last : 34;
      // A small, fixed field at 30fps; lower the budget if painting is expensive.
      if (elapsed < (slow ? 50 : 1000 / 30) - 1) { raf = requestAnimationFrame(frame); return; }
      last = now;
      const delta = Math.min(elapsed / 1000, .08);
      for (const star of stars) {
        star.age += delta;
        if (star.age >= star.life) {
          star.age = 0;
          star.life = 5 + Math.random() * 5;
          star.x = Math.random(); star.y = Math.random();
        }
      }
      const follow = 1 - Math.exp(-delta * 9);
      pointerX += (targetX - pointerX) * follow;
      pointerY += (targetY - pointerY) * follow;
      strength += ((hovering ? 1 : 0) - strength) * follow;
      const start = performance.now();
      paint();
      if (performance.now() - start > 7) slow = true;
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(frame);
    };
    const palette = () => { ctx.fillStyle = getComputedStyle(canvas).color; paint(); };
    const resize = () => {
      bounds = host.getBoundingClientRect();
      width = Math.round(bounds.width); height = Math.round(bounds.height);
      const ratio = Math.min(devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.font = "13px monospace";
      palette(); start();
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced.matches) return;
      bounds = host.getBoundingClientRect();
      targetX = pointerX = event.clientX - bounds.left;
      targetY = pointerY = event.clientY - bounds.top;
      hovering = true;
    };
    const move = (event: PointerEvent) => {
      targetX = event.clientX - bounds.left;
      targetY = event.clientY - bounds.top;
    };
    const leave = () => { hovering = false; };
    const scroll = () => { hovering = false; };
    const visibility = () => { stop(); start(); };
    const preference = () => { stop(); strength = 0; paint(); start(); };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      if (visible) start(); else stop();
    });
    const size = new ResizeObserver(resize);
    const theme = new MutationObserver(palette);
    resize(); observer.observe(host); size.observe(host);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    host.addEventListener("pointerenter", enter, { passive: true });
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", preference);
    scheme.addEventListener("change", palette);
    return () => {
      stop(); observer.disconnect(); size.disconnect(); theme.disconnect();
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", preference);
      scheme.removeEventListener("change", palette);
    };
  }, []);
  return <canvas ref={ref} className="hero-ascii" aria-hidden="true" />;
}
