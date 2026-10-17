"use client";

import { useEffect } from "react";

/** Progressive enhancement: content stays visible before JS and with reduced motion. */
export function HomeMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const targets = document.querySelectorAll<HTMLElement>(".home-redesign [data-home-reveal]");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("home-reveal-in");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return null;
}
