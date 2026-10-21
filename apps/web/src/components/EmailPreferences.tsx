"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { apiFetch } from "@/lib/api";

/**
 * Three separate yeses, all unchecked until someone ticks them: ADCode updates (new releases, new
 * docs, project ideas and a short series of reminders after time away), status emails (when free
 * AI has an outage and when it is fixed), and model emails (a new free model, and how the models
 * have been performing). None implies another, and each email says which one it answers and
 * carries a link that stops it.
 */
interface Preferences { subscribed: boolean; email: string | null; eligible: boolean; suppressed: boolean; statusUpdates: boolean; modelUpdates: boolean }
export function EmailPreferences() {
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState(false);
  const [models, setModels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await apiFetch<Preferences>({ path: "/email-preferences", token: await token() });
      if (!active) return;
      if (result.ok) { setPrefs(result.value); setChecked(result.value.subscribed); setStatus(result.value.statusUpdates === true); setModels(result.value.modelUpdates === true); }
      else setMessage("Email preferences are temporarily unavailable. Please try again later.");
    })();
    return () => { active = false; };
  }, [token]);
  const changed = prefs !== null && (checked !== prefs.subscribed || status !== (prefs.statusUpdates === true) || models !== (prefs.modelUpdates === true));
  const labelStyle = { display: "flex", alignItems: "flex-start", gap: 12, lineHeight: 1.6, maxWidth: "60ch", cursor: prefs?.eligible && !busy ? "pointer" : "default" } as const;
  const boxStyle = { width: 19, height: 19, marginTop: 3, flexShrink: 0, accentColor: "var(--fg)" } as const;
  return (
    <section className="workspace-section" id="email-preferences" aria-labelledby="email-preferences-title">
      <h2 className="workspace-section-title" id="email-preferences-title">A little inspiration, occasionally.</h2>
      <p className="field-hint" style={{ maxWidth: "60ch", marginBottom: 20 }}>Choose what ADCode can email you. Each one is separate, and every email has a link that stops it.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!prefs || busy) return;
        setBusy(true); setMessage("");
        void (async () => {
          try {
            const result = await apiFetch<Preferences>({ path: "/email-preferences", method: "PATCH", token: await token(), body: { subscribed: checked, statusUpdates: status, modelUpdates: models } });
            if (result.ok) {
              setPrefs(result.value); setChecked(result.value.subscribed); setStatus(result.value.statusUpdates === true); setModels(result.value.modelUpdates === true);
              setMessage(result.value.subscribed || result.value.statusUpdates || result.value.modelUpdates ? "Saved. We will keep it useful." : "Saved. ADCode will not email you updates.");
            } else setMessage("We could not save that change. Please try again.");
          } finally { setBusy(false); }
        })();
      }}>
        <div style={{ display: "grid", gap: 14 }}>
          <label style={labelStyle}>
            <input type="checkbox" checked={checked} disabled={!prefs?.eligible || busy} onChange={(event) => { setChecked(event.target.checked); setMessage(""); }} style={boxStyle} />
            <span>Email me ADCode updates{prefs?.email ? " at " + prefs.email : ""}: new releases, new docs, project ideas, and a few reminders after I have been away.</span>
          </label>
          <label style={labelStyle}>
            <input type="checkbox" checked={status} disabled={!prefs?.eligible || busy} onChange={(event) => { setStatus(event.target.checked); setMessage(""); }} style={boxStyle} />
            <span>Email me when free AI has an outage, and again when it is fixed.</span>
          </label>
          <label style={labelStyle}>
            <input type="checkbox" checked={models} disabled={!prefs?.eligible || busy} onChange={(event) => { setModels(event.target.checked); setMessage(""); }} style={boxStyle} />
            <span>Email me about the AI models: when a new free model arrives, and a report on how each one has been performing.</span>
          </label>
        </div>
        {prefs && !prefs.eligible && <p className="field-hint">Sign in with a verified email address to choose email updates.</p>}
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="btn btn-outline btn-small" type="submit" disabled={!prefs?.eligible || busy || !changed}>{busy ? "Saving…" : "Save email preferences"}</button>
        </div>
        <p role="status" aria-live="polite" className="field-hint" style={{ minHeight: "1.6em", marginTop: 12 }}>{message}</p>
      </form>
    </section>
  );
}
