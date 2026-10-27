"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide";
import { Icon } from "./Icon";
import { ago } from "@/lib/adminCache";

/**
 * "Updated 12 seconds ago", and Refresh. Counts every second for the first minute, then
 * every fifteen, so it stays honest without re-rendering a page sixty times a minute.
 */
export function RefreshStamp({ asOf, refreshing, onRefresh, fromCache = false }: { asOf: number | null; refreshing: boolean; onRefresh: () => void; fromCache?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const young = asOf !== null && Date.now() - asOf < 60_000;
    const timer = window.setInterval(() => setNow(Date.now()), young ? 1_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [asOf, refreshing]);
  const label = asOf === null ? (refreshing ? "Loading…" : "Not loaded yet") : refreshing ? `Refreshing · updated ${ago(asOf, now)}` : `Updated ${ago(asOf, now)}`;
  return (
    <div className="refresh-stamp" data-refreshing={refreshing} data-cached={fromCache && refreshing}>
      <span className="refresh-stamp-text" role="status" aria-live="polite" title={asOf === null ? undefined : new Date(asOf).toLocaleString()}>{label}</span>
      <button type="button" className="refresh-stamp-button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
        <Icon node={RotateCw} size={14} />
        <span>Refresh</span>
      </button>
    </div>
  );
}
