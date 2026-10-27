
export const STATUS_CANDLE_MS = 2 * 3_600_000;
export const STATUS_CANDLE_DAYS = 7;
export const STATUS_CANDLE_COUNT = STATUS_CANDLE_DAYS * 12;
export const STATUS_LIVE_WINDOW_MINUTES = 15;

/** Aggregates only: no account, request id, prompt or upstream error text. */
export interface StatusBucketRow {
  startAt: number;
  model: string;
  outcome: "ok" | "error";
  count: number;
  totalMs: number;
  recentCount: number;
}

export interface StatusCandle {
  startAt: number;
  endAt: number;
  level: string;
  turns: number;
  errors: number;
  avgMs: number | null;
}
