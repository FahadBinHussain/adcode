/** Relative change of the same metric a day apart. Money stays exact until formatting. */
export function dailyChange(current: number | bigint | null, previous: number | bigint | null | undefined): { label: string; direction: "up" | "down" | "flat" | "none" } {
  if (current === null || previous == null || (typeof current === "number" && !Number.isFinite(current)) || (typeof previous === "number" && !Number.isFinite(previous)) || current < 0 || previous < 0) return { label: "No comparison", direction: "none" };
  if (previous === 0 || previous === 0n) return current === 0 || current === 0n ? { label: "0.0%", direction: "flat" } : { label: "New", direction: "up" };
  const value = typeof current === "bigint" && typeof previous === "bigint"
    ? Number((current - previous) * 10000n / previous) / 100
    : (Number(current) - Number(previous)) / Number(previous) * 100;
  const rounded = Math.round(value * 10) / 10;
  return { label: `${rounded > 0 ? "+" : ""}${rounded === 0 ? "0.0" : rounded.toFixed(1)}%`, direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat" };
}
