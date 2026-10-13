export interface LiveImpressions { total: number; asOf: number }

export function parseLiveImpressions(value: unknown): LiveImpressions | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (![data.total, data.asOf].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) return null;
  return { total: data.total as number, asOf: data.asOf as number };
}
