import { dailyChange } from "@/lib/dailyChange";
import { Icon } from "@/components/Icon";
import { Minus, TrendingDown, TrendingUp } from "lucide";

export function DailyChange({ current, previous, lowerIsBetter = false, unavailableReason }: {
  current: number | bigint | null; previous: number | bigint | null | undefined; lowerIsBetter?: boolean; unavailableReason?: string | undefined;
}) {
  const change = dailyChange(current, previous);
  const tone = change.direction === "flat" || change.direction === "none" ? "neutral" : (change.direction === "up") !== lowerIsBetter ? "good" : "bad";
  return <small className="analytics-daily-change" data-tone={tone} title={change.direction === "none" ? unavailableReason ?? "A previous-day measurement is not available." : "Relative change from the same value 24 hours earlier. Rolling windows keep the same length; totals include records through each cutoff."}>
    <span aria-hidden="true"><Icon node={change.direction === "up" ? TrendingUp : change.direction === "down" ? TrendingDown : Minus} /></span>
    <span>{change.label}</span>{change.direction !== "none" && <span className="analytics-daily-change-note"> vs yesterday</span>}
  </small>;
}
