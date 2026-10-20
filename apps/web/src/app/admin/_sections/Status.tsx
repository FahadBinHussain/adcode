"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpNote } from "@/components/HelpNote";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";
import "@/components/adminStatus.css";

interface StatusUpdate {
  updateId: string;
  status: string;
  body: string;
  createdAt: number;
}

interface StatusIncident {
  incidentId: string;
  title: string;
  impact: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  updates: StatusUpdate[];
}

/** Local copies of the vocabulary `services/api/src/status.ts` accepts, with the panel's voice. */
const IMPACTS = [
  { value: "minor", label: "Minor — some people, some requests" },
  { value: "major", label: "Major — most people affected" },
  { value: "critical", label: "Critical — the service is unusable" },
  { value: "maintenance", label: "Maintenance — planned work" },
  { value: "none", label: "Informational — nothing is broken" },
] as const;

const STATES = [
  { value: "investigating", label: "Investigating" },
  { value: "identified", label: "Identified" },
  { value: "monitoring", label: "Monitoring" },
  { value: "resolved", label: "Resolved" },
] as const;

const IMPACT_LABEL: Record<string, string> = {
  none: "Informational",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  maintenance: "Maintenance",
};

const STATE_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

/**
 * The public status page's incident log, written here.
 *
 * Model health is not managed from this page on purpose - it is measured, not typed. What
 * an admin writes is the part no measurement can say: that somebody knows, what is
 * happening, and when it stopped. Each update publishes to /status and its feed the moment
 * it lands, so an incident is one form away from being told.
 */
export function StatusBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<StatusIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<string>("major");
  const [state, setState] = useState<string>("investigating");
  const [body, setBody] = useState("");

  const [drafts, setDrafts] = useState<Record<string, { status: string; body: string }>>({});

  const load = useCallback(async () => {
    const found = await apiFetch<{ incidents: StatusIncident[] }>({ path: "/admin/status", token: await token() });
    if (found.ok) setRows(found.value.incidents);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (title.trim().length === 0 || body.trim().length === 0) {
      setError("An incident needs a title and at least one update sentence.");
      return;
    }

    setBusy(true);
    setError(null);
    setPosted(null);

    const result = await apiFetch<StatusIncident>({
      path: "/admin/status/incidents",
      token: await token(),
      method: "POST",
      body: { title: title.trim(), impact, status: state, body: body.trim() },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setPosted(result.value.title);
    setTitle("");
    setBody("");
    setState("investigating");
    void load();
  };

  const addUpdate = async (incidentId: string) => {
    if (busy) return;
    const draft = drafts[incidentId] ?? { status: "identified", body: "" };
    if (draft.body.trim().length === 0) {
      setError("An update needs a sentence.");
      return;
    }

    setBusy(true);
    setError(null);
    setPosted(null);

    const result = await apiFetch<StatusIncident>({
      path: `/admin/status/incidents/${encodeURIComponent(incidentId)}/updates`,
      token: await token(),
      method: "POST",
      body: { status: draft.status, body: draft.body.trim() },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setPosted(`${result.value.title} — ${STATE_LABEL[result.value.status] ?? result.value.status}`);
    setDrafts((current) => ({ ...current, [incidentId]: { status: draft.status, body: "" } }));
    void load();
  };

  const setDraft = (incidentId: string, patch: Partial<{ status: string; body: string }>): void =>
    setDrafts((current) => ({
      ...current,
      [incidentId]: { status: "identified", body: "", ...current[incidentId], ...patch },
    }));

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {posted !== null && (
        <div className="notice" data-tone="ok" role="status">
          Published: {posted}. It is on the status page and its feed now.
        </div>
      )}

      <HelpNote id="admin-status">
        Posting here is what turns a yellow bar on the public status page into a story: what
        is wrong, what you know, and when it ended. Each update appears on /status and in the
        RSS feed immediately — there is no email, so write for someone reading cold. Model
        uptime and error rates below the incidents are measured automatically and cannot be
        typed over.
      </HelpNote>

      <form onSubmit={open} style={{ maxWidth: 620, marginBottom: 40 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Open an incident</h3>

        <div className="field">
          <label htmlFor="s-title">Title</label>
          <span className="field-hint">{title.length}/120. What is happening, seen from outside — &ldquo;Elevated errors on free models&rdquo;.</span>
          <input
            id="s-title"
            className="input"
            maxLength={120}
            placeholder="Elevated errors on free models"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="s-impact">Impact</label>
          <select id="s-impact" className="select" value={impact} onChange={(event) => setImpact(event.target.value)}>
            {IMPACTS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="s-state">State</label>
          <select id="s-state" className="select" value={state} onChange={(event) => setState(event.target.value)}>
            {STATES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="s-body">First update</label>
          <span className="field-hint">
            {body.length}/2000. What you know so far, in one or two sentences. &ldquo;We are investigating&rdquo;
            is a full update; saying nothing is not.
          </span>
          <textarea
            id="s-body"
            className="textarea"
            maxLength={2000}
            placeholder="Requests to free models are failing for some people. We are looking now."
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Posting…" : "Post to the status page"}
          </button>
          <a className="btn btn-outline" href="/status" target="_blank" rel="noreferrer">
            View the public page
          </a>
        </div>
      </form>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Incidents</h3>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing posted</h3>
          <p>Incidents you open appear here, resolved ones included, with every update you posted.</p>
        </div>
      ) : (
        <div className="rows">
          {rows.map((incident) => {
            const draft = drafts[incident.incidentId] ?? { status: incident.status === "resolved" ? "investigating" : "identified", body: "" };
            return (
              <div className="row" key={incident.incidentId} style={{ display: "block" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                  <span className="row-main">
                    <span className="row-title">{incident.title}</span>
                    <span className="row-sub">
                      <span className="pill" data-tone={incident.status === "resolved" ? "ended" : "live"}>
                        {STATE_LABEL[incident.status] ?? incident.status}
                      </span>{" "}
                      {IMPACT_LABEL[incident.impact] ?? incident.impact} impact · opened {when(incident.createdAt)}
                      {incident.resolvedAt === null ? "" : ` · resolved ${when(incident.resolvedAt)}`}
                    </span>
                  </span>
                </div>

                <ol style={{ display: "grid", gap: 10, margin: "14px 0 0", padding: 0, listStyle: "none" }}>
                  {incident.updates.map((update) => (
                    <li key={update.updateId} style={{ borderLeft: "2px solid var(--hairline)", paddingLeft: 12 }}>
                      <p style={{ fontSize: 13, lineHeight: 1.7 }}>
                        <strong>{STATE_LABEL[update.status] ?? update.status}</strong> — {update.body}
                      </p>
                      <span className="row-sub">{when(update.createdAt)}</span>
                    </li>
                  ))}
                </ol>

                <details className="admin-status-compose" style={{ marginTop: 16 }}>
                  <summary>{incident.status === "resolved" ? "Reopen or add an update" : "Add an update"}</summary>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor={`u-state-${incident.incidentId}`}>State</label>
                    <select
                      id={`u-state-${incident.incidentId}`}
                      className="select"
                      value={draft.status}
                      onChange={(event) => setDraft(incident.incidentId, { status: event.target.value })}
                    >
                      {STATES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`u-body-${incident.incidentId}`}>Update</label>
                    <span className="field-hint">
                      {draft.body.length}/2000. Posting &ldquo;Resolved&rdquo; closes the incident; any other state
                      on a closed one reopens it.
                    </span>
                    <textarea
                      id={`u-body-${incident.incidentId}`}
                      className="textarea"
                      maxLength={2000}
                      placeholder="The fix is deployed and errors are back to normal. We are watching for a while."
                      value={draft.body}
                      onChange={(event) => setDraft(incident.incidentId, { body: event.target.value })}
                    />
                  </div>
                  <div className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void addUpdate(incident.incidentId)}>
                      {busy ? "Posting…" : "Post update"}
                    </button>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <p className="field-hint" style={{ marginTop: 18, maxWidth: "64ch" }}>
        An incident is a record: nothing here can be deleted. Correcting something means
        posting the correction, the way it works for everyone reading.
      </p>
    </>
  );
}
