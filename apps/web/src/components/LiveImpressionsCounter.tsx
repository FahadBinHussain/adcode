"use client";

import { useEffect, useRef, useState } from "react";
import { parseLiveImpressions } from "@/lib/liveImpressions";

export type CounterState = { status: "loading" } | { status: "ready"; total: number } | { status: "offline" };

const COUNT_UP_MS = 1100;
const REFRESH_MS = 15_000;

/** Eased progress from the displayed number to the next recorded total. */
export function countUpValue(target: number, progress: number, from = 0): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.round(from + (target - from) * (1 - Math.pow(1 - clamped, 3)));
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(() => typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0);
  const displayed = useRef(shown);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayed.current = value;
      setShown(value);
      return;
    }
    const from = displayed.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = (now - start) / COUNT_UP_MS;
      displayed.current = countUpValue(value, progress, from);
      setShown(displayed.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toLocaleString("en-US")}</>;
}

export function LiveImpressionsCounterView({ state }: { state: CounterState }) {
  if (state.status === "offline") return null;
  const ready = state.status === "ready";
  const digits = ready ? state.total.toLocaleString("en-US").length : 9;
  return (
    <div
      className="hero-dev-counter"
      role="group"
      aria-busy={!ready}
      aria-label={ready ? `${state.total.toLocaleString("en-US")} live impressions` : "Loading live impressions"}
    >
      <span className="hero-dev-counter-live" aria-hidden="true"><i /> Live impressions</span>
      <div className="hero-dev-counter-value" data-digits={digits > 12 ? "long" : digits > 9 ? "medium" : "short"} aria-hidden="true">
        {ready ? <CountUp value={state.total} /> : <span className="hero-dev-counter-blank" />}
      </div>
    </div>
  );
}

export function LiveImpressionsCounter() {
  const [state, setState] = useState<CounterState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await fetch("/v1/impressions", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        const next = response.ok ? parseLiveImpressions(await response.json()) : null;
        if (controller.signal.aborted) return;
        setState((current) => next === null
          ? current.status === "ready" ? current : { status: "offline" }
          : { status: "ready", total: next.total });
      } catch {
        if (!controller.signal.aborted) setState((current) => current.status === "ready" ? current : { status: "offline" });
      } finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <LiveImpressionsCounterView state={state} />;
}
