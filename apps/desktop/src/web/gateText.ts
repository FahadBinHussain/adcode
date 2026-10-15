/**
 * The words the web version's own screens use: sign-in errors and time left in this session.
 *
 * Pure, so they are tested without a browser. Firebase error codes become sentences a person
 * can act on; anything not listed falls back to a plain "try again" rather than a code.
 */

const FIREBASE_ERRORS: Readonly<Record<string, string>> = {
  "auth/unauthorized-domain": "Sign-in isn't set up for this address yet. Try again soon, or use the desktop app.",
  "auth/invalid-credential": "That email and password don't match.",
  "auth/wrong-password": "That email and password don't match.",
  "auth/user-not-found": "There's no account with that email yet. Choose Create account instead.",
  "auth/email-already-in-use": "That email already has an account. Choose Sign in instead.",
  "auth/weak-password": "Use at least 6 characters for your password.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/too-many-requests": "Too many tries. Wait a minute, then try again.",
  "auth/network-request-failed": "Couldn't reach the sign-in service. Check your connection and try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.",
  "auth/account-exists-with-different-credential": "That email already signs in another way. Use the button you used before.",
};

const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

/** A sentence for a Firebase error, or null when there is nothing to say (the person closed the window). */
export function firebaseErrorText(code: string | null | undefined): string | null {
  if (typeof code === "string" && SILENT.has(code)) return null;
  if (typeof code === "string" && FIREBASE_ERRORS[code] !== undefined) return FIREBASE_ERRORS[code];
  return "Sign-in didn't work. Try again.";
}

/** "47 min left", "1 h 15 min left", or "Less than a minute left". */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "No time left";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Less than a minute left";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`;
}

/** How urgent the time left looks: plenty, getting low (10 minutes or less), or the last two. */
export function timeTone(ms: number): "ok" | "low" | "last" {
  if (ms <= 2 * 60_000) return "last";
  if (ms <= 10 * 60_000) return "low";
  return "ok";
}

/** "Refills at 02:00", in the person's own clock. */
export function formatReset(resetsAt: number, locale?: string): string {
  return `Refills at ${new Date(resetsAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

/** "5 min ago", "yesterday", "12 Oct" - never a time in the future. */
export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
