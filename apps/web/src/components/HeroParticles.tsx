"use client";

import { useEffect, useRef } from "react";

type Particle = {
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  influence: number;
  mark: number;
};

type Connection = { from: number; to: number };

const COLUMNS = 8;
const ROWS = 6;
const RADIUS = 170;
const DISPLACEMENT = 18;
const FRAME_MS = 1000 / 30;
const jitter = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** A decorative field: no input interception, layout changes, or idle animation loop. */
export function HeroParticles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return;

    const capability = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    let bounds = host.getBoundingClientRect();
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let particles: Particle[] = [];
    let connections: Connection[] = [];
    let ink = "120, 120, 120";
    let raf = 0;
    let lastPaint = 0;
    let opacity = 0;
    let visible = !("IntersectionObserver" in window);
    let hovering = false;
    let clientX = 0;
    let clientY = 0;
    let targetX = 0;
    let targetY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let disposed = false;

    const available = () => !disposed && capability.matches && visible && !document.hidden && width > 0 && height > 0;

    const stop = () => {
      window.cancelAnimationFrame(raf);
      raf = 0;
      lastPaint = 0;
      opacity = 0;
      hovering = false;
      for (const particle of particles) {
        particle.x = particle.anchorX;
        particle.y = particle.anchorY;
        particle.influence = 0;
      }
      context.clearRect(0, 0, width, height);
    };

    const frame = (now: number) => {
      raf = 0;
      if (!available()) {
        stop();
        return;
      }
      if (lastPaint !== 0 && now - lastPaint < FRAME_MS) {
        raf = window.requestAnimationFrame(frame);
        return;
      }
      const delta = lastPaint === 0 ? 1 / 30 : Math.min((now - lastPaint) / 1000, .06);
      lastPaint = now;
      const follow = 1 - Math.exp(-delta * 14);
      const fade = 1 - Math.exp(-delta * 11);
      pointerX += (targetX - pointerX) * follow;
      pointerY += (targetY - pointerY) * follow;
      const targetOpacity = hovering ? 1 : 0;
      opacity += (targetOpacity - opacity) * fade;
      let unsettled = Math.abs(targetOpacity - opacity) > .005 || Math.abs(targetX - pointerX) + Math.abs(targetY - pointerY) > .1;

      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const dx = particle.anchorX - pointerX;
        const dy = particle.anchorY - pointerY;
        const distance = Math.hypot(dx, dy);
        const influence = hovering ? Math.max(0, 1 - distance / RADIUS) ** 2 : 0;
        const offset = influence * DISPLACEMENT;
        const denominator = Math.max(distance, 1);
        const nextX = particle.anchorX + dx / denominator * offset;
        const nextY = particle.anchorY + dy / denominator * offset;
        particle.x += (nextX - particle.x) * follow;
        particle.y += (nextY - particle.y) * follow;
        particle.influence = influence;
        unsettled ||= Math.abs(nextX - particle.x) + Math.abs(nextY - particle.y) > .05;
      }

      if (opacity > .006) {
        context.strokeStyle = `rgb(${ink})`;
        context.fillStyle = `rgb(${ink})`;
        context.lineWidth = .7;
        for (const connection of connections) {
          const from = particles[connection.from]!;
          const to = particles[connection.to]!;
          context.globalAlpha = opacity * (.075 + Math.max(from.influence, to.influence) * .22);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }
        for (const particle of particles) {
          context.globalAlpha = opacity * (.24 + particle.influence * .3);
          const size = 1.2 + particle.influence * .6;
          context.beginPath();
          if (particle.mark === 0) {
            context.moveTo(particle.x - 2.5, particle.y);
            context.lineTo(particle.x + 2.5, particle.y);
            context.moveTo(particle.x, particle.y - 2.5);
            context.lineTo(particle.x, particle.y + 2.5);
            context.stroke();
          } else if (particle.mark === 1) {
            context.strokeRect(particle.x - 2, particle.y - 2, 4, 4);
          } else {
            context.arc(particle.x, particle.y, size, 0, Math.PI * 2);
            context.fill();
          }
        }
        context.globalAlpha = 1;
      }
      if (unsettled && (hovering || opacity > .006)) raf = window.requestAnimationFrame(frame);
      else if (!hovering) stop();
    };

    const requestFrame = () => {
      if (raf !== 0 || !available()) return;
      lastPaint = 0;
      raf = window.requestAnimationFrame(frame);
    };

    const palette = () => {
      // Computing color resolves --text's light-dark() into concrete RGB once per theme.
      const channels = window.getComputedStyle(canvas).color.match(/[\d.]+/g)?.slice(0, 3);
      if (channels?.length === 3) ink = channels.join(", ");
      if (hovering || opacity > 0) requestFrame();
    };

    const cacheBounds = () => {
      bounds = host.getBoundingClientRect();
      targetX = clientX - bounds.left;
      targetY = clientY - bounds.top;
    };

    const resize = () => {
      cacheBounds();
      const nextWidth = bounds.width;
      const nextHeight = bounds.height;
      const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (width === nextWidth && height === nextHeight && pixelRatio === nextRatio) return;
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextRatio;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      particles = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
        const anchorX = ((index % COLUMNS + .5 + (jitter(index + 1) - .5) * .65) / COLUMNS) * width;
        const anchorY = ((Math.floor(index / COLUMNS) + .5 + (jitter(index + 57) - .5) * .65) / ROWS) * height;
        return { anchorX, anchorY, x: anchorX, y: anchorY, influence: 0, mark: index % 17 };
      });
      const pairs = new Set<string>();
      connections = [];
      for (const [index, particle] of particles.entries()) {
        const nearest = particles.map((other, otherIndex) => ({ index: otherIndex, distance: Math.hypot(other.anchorX - particle.anchorX, other.anchorY - particle.anchorY) }))
          .filter((other) => other.index !== index && other.distance < RADIUS)
          .sort((a, b) => a.distance - b.distance).slice(0, 2);
        for (const other of nearest) {
          const from = Math.min(index, other.index);
          const to = Math.max(index, other.index);
          const key = `${from}:${to}`;
          if (pairs.has(key)) continue;
          pairs.add(key);
          connections.push({ from, to });
        }
      }
      if (hovering) requestFrame();
    };

    const pointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !capability.matches) return;
      const entering = !hovering;
      clientX = event.clientX;
      clientY = event.clientY;
      if (entering) cacheBounds();
      else {
        targetX = clientX - bounds.left;
        targetY = clientY - bounds.top;
      }
      if (entering) {
        pointerX = targetX;
        pointerY = targetY;
      }
      hovering = true;
      requestFrame();
    };
    const leave = () => {
      hovering = false;
      requestFrame();
    };
    const scroll = () => {
      if (!hovering) return;
      cacheBounds();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight || bounds.right <= 0 || bounds.left >= window.innerWidth) {
        stop();
        return;
      }
      if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
        leave();
        return;
      }
      requestFrame();
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    const preference = () => {
      stop();
      palette();
    };

    resize();
    palette();
    const sizeObserver = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
    sizeObserver?.observe(host);
    const intersection = "IntersectionObserver" in window ? new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      if (!visible) stop();
      else if (hovering) requestFrame();
    }, { threshold: 0 }) : null;
    intersection?.observe(host);
    const themeObserver = new MutationObserver(palette);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    host.addEventListener("pointerenter", pointer, { passive: true });
    host.addEventListener("pointermove", pointer, { passive: true });
    host.addEventListener("pointerleave", leave, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    capability.addEventListener("change", preference);
    colorScheme.addEventListener("change", palette);

    return () => {
      disposed = true;
      stop();
      sizeObserver?.disconnect();
      intersection?.disconnect();
      themeObserver.disconnect();
      host.removeEventListener("pointerenter", pointer);
      host.removeEventListener("pointermove", pointer);
      host.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
      capability.removeEventListener("change", preference);
      colorScheme.removeEventListener("change", palette);
    };
  }, []);

  return <canvas ref={ref} className="home-hero-particles" aria-hidden="true" style={{ color: "var(--text)" }} />;
}
