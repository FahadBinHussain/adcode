"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "@/lib/api";

interface Preferences { subscribed: boolean; email: string | null; eligible: boolean; suppressed: boolean }
export function EmailPreferences() {
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await apiFetch<Preferences>({ path: "/email-preferences", token: await token() });
      if (!active) return;
      if (result.ok) { setPrefs(result.value); setChecked(result.value.subscribed); }
      else setMessage("Email preferences are temporarily unavailable. Please try again later.");
    })();
    return () => { active = false; };
  }, [token]);
  return (
    <section className="workspace-section" id="email-preferences" aria-labelledby="email-preferences-title">
      <h2 className="workspace-section-title" id="email-preferences-title">A little inspiration, occasionally.</h2>
      <p className="field-hint" style={{ maxWidth: "60ch", marginBottom: 20 }}>Choose whether ADCode can email you product updates, project ideas, and a short series of reminders after you have been away. You can unsubscribe at any time.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!prefs || busy) return;
        setBusy(true); setMessage("");
        void (async () => {
          try {
            const result = await apiFetch<Preferences>({ path: "/email-preferences", method: "PATCH", token: await token(), body: { subscribed: checked } });
            if (result.ok) { setPrefs(result.value); setChecked(result.value.subscribed); setMessage(result.value.subscribed ? "You are on the list. We will keep it useful." : "You will not receive product updates or reminders."); }
            else setMessage("We could not save that change. Please try again.");
          } finally { setBusy(false); }
        })();
      }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, lineHeight: 1.6, maxWidth: "60ch", cursor: prefs?.eligible && !busy ? "pointer" : "default" }}>
          <input type="checkbox" checked={checked} disabled={!prefs?.eligible || busy} onChange={(event) => { setChecked(event.target.checked); setMessage(""); }} style={{ width: 19, height: 19, marginTop: 3, flexShrink: 0, accentColor: "var(--fg)" }} />
          <span>Yes, email me ADCode updates and project ideas{prefs?.email ? " at " + prefs.email : ""}.</span>
        </label>
        {prefs && !prefs.eligible && <p className="field-hint">Sign in with a verified email address to join the list.</p>}
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="btn btn-outline btn-small" type="submit" disabled={!prefs?.eligible || busy || checked === prefs.subscribed}>{busy ? "Saving…" : "Save email preference"}</button>
        </div>
        <p role="status" aria-live="polite" className="field-hint" style={{ minHeight: "1.6em", marginTop: 12 }}>{message}</p>
      </form>
    </section>
  );
}
