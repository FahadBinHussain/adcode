import type { Provider } from "./types.ts";

type LimitError = { status?: number; code?: string; retryAfter?: string | null; retryable?: boolean; resetsAt?: number; message?: string };

/** Re-check wall time every minute so a sleeping computer resumes after the reset. */
async function waitUntil(at: number, signal: AbortSignal): Promise<void> {
  while (Date.now() < at) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cancel = (): void => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason ?? new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, Math.min(60_000, at - Date.now()));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  signal.throwIfAborted();
}

function resetTime(error: LimitError, daily: boolean): number {
  const now = Date.now();
  if (daily && Number.isSafeInteger(error.resetsAt) && error.resetsAt! > now) return Math.min(error.resetsAt!, now + 86_400_000);
  const raw = error.retryAfter;
  const seconds = raw == null || raw.trim() === "" ? NaN : Number(raw);
  const at = Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(at)) return Math.min(Math.max(now + 1000, at), now + 86_400_000);
  return daily ? (Math.floor(now / 86_400_000) + 1) * 86_400_000 : now + 60_000;
}

/** Keep the pending request inside its existing agent turn; completed tools are not replayed. */
export function recoverIncludedLimits(provider: Provider): Provider {
  return {
    ...provider,
    async *stream(request, signal) {
      for (;;) {
        signal.throwIfAborted();
        let producedOutput = false;
        try {
          for await (const event of provider.stream(request, signal)) {
            if (event.kind !== "status") producedOutput = true;
            yield event;
          }
          return;
        } catch (caught) {
          if (signal.aborted || producedOutput || typeof caught !== "object" || caught === null) throw caught;
          const error = caught as LimitError;
          const code = error.code ?? /\(code (daily-limit|rate-limit|upstream-rate-limit)\)/.exec(error.message ?? "")?.[1];
          if (error.status !== 429 || error.retryable === false || !["daily-limit", "rate-limit", "upstream-rate-limit"].includes(code ?? "")) throw caught;
          const daily = code === "daily-limit";
          const at = resetTime(error, daily);
          const when = new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
          yield { kind: "status", text: daily
            ? `Free AI allowance reached. This task will resume automatically after ${when}. Keep ADCode open; press Stop to cancel.`
            : `Free AI is temporarily limited. This task will retry automatically after ${when}. Press Stop to cancel.` };
          await waitUntil(at, signal);
          yield { kind: "status", text: "Checking the limit and resuming this task automatically…" };
        }
      }
    },
  };
}
