/** The existing portal, mounted inside Vibe with the current browser session. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AuthContext, type AuthState } from "../../../web/src/components/AuthContext";
import { DashboardBody } from "../../../web/src/components/DashboardBody";
import { currentUser } from "./firebaseAuth.ts";
import type { WebSession } from "./gate.ts";
import baseStyles from "../../../web/src/app/globals.css?inline";
import designStyles from "../../../web/src/app/design-system.css?inline";
import appearanceStyles from "../../../web/src/app/redesign.css?inline";
import accountStyles from "./accountPanel.css?inline";

const SECTIONS = [
  ["overview", "Overview"], ["earnings", "Earnings"], ["invites", "Invites"],
  ["payouts", "Payouts"], ["activity", "Activity"], ["ledger", "Ledger"],
  ["email-preferences", "Email preferences"],
] as const;
type Section = typeof SECTIONS[number][0];
export function accountSection(value: unknown): Section {
  return SECTIONS.find(([id]) => id === value)?.[0] ?? "overview";
}
let active: HTMLDialogElement | null = null;

export async function openAccountPanel(session: WebSession, initial: unknown = "overview"): Promise<void> {
  if (active !== null) { active.focus(); return; }
  const dialog = document.createElement("dialog");
  dialog.className = "web-account-dialog";
  dialog.setAttribute("aria-label", "Your account");
  // Shadow styles keep the portal's forms and charts from changing the editor's controls.
  const host = document.createElement("div");
  dialog.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = [baseStyles, designStyles, appearanceStyles].join("\n")
    .replace(/:root\[([^\]]+)\]/g, ":host([$1])").replaceAll(":root", ":host") + accountStyles;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  const theme = (): void => {
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    dialog.style.colorScheme = scheme;
    host.dataset["theme"] = scheme.includes("dark") ? "dark" : "light";
  };
  theme();
  const observer = new MutationObserver(theme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
  document.body.append(dialog);
  active = dialog;
  const previous = document.activeElement;
  const root = createRoot(mount);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    observer.disconnect(); root.unmount(); dialog.remove(); active = null;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
  const close = (): void => {
    dialog.close();
    // A resumed background tab can delay the native close event until its next frame.
    // Unmount after React's click handler, without depending on another painted frame.
    queueMicrotask(dispose);
  };
  dialog.addEventListener("close", dispose, { once: true });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.showModal();
  root.render(<div className="account-loading" role="status">Opening your account…</div>);
  try {
    const user = (session.token === null || session.token === "dev") ? null : await currentUser();
    if (!dialog.open) return;
    const auth: AuthState = { user, token: () => session.refresh(false), configured: true, loading: false, isAdmin: false, adminLoading: false };
    root.render(<AuthContext.Provider value={auth}><Account initial={accountSection(initial)} close={close} session={session} /></AuthContext.Provider>);
  } catch {
    if (dialog.open) root.render(<div className="account-loading" role="alert"><p>Couldn't open your account. Please try again.</p><button onClick={close}>Back to workspace</button></div>);
  }
}

function Account({ initial, close, session }: { initial: Section; close: () => void; session: WebSession }) {
  const [section, setSection] = useState(initial);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  return <div className="account-shell">
    <header className="account-heading">
      <div><span className="account-eyebrow">YOUR WORKSPACE</span><h1>Your account</h1><p>{session.email ?? "Manage everything, right here in ADCode."}</p></div>
      <button type="button" className="account-back" onClick={close}>Back to workspace <span aria-hidden="true">↗</span></button>
    </header>
    <div className="account-layout">
      <nav className="account-nav" aria-label="Account sections">
        {SECTIONS.map(([id, label]) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}<span aria-hidden="true">{section === id ? "↗" : ""}</span></button>)}
        <div className="account-nav-foot"><p>Build something.<br />Your earnings come with you.</p><button type="button" disabled={leaving} onClick={() => {
          setLeaving(true); setError("");
          void session.signOut().catch(() => { setLeaving(false); setError("Couldn't sign out. Please try again."); });
        }}>{leaving ? "Signing out…" : "Sign out"}</button></div>
      </nav>
      <main className="account-main" aria-label={SECTIONS.find(([id]) => id === section)?.[1]}>
        {error && <p role="alert">{error}</p>}
        {(session.token === null || session.token === "dev") ? <div className="account-local"><h2>Your account lives here.</h2><p>You're exploring a local workspace. Sign in with your ADCode account to see your balance, manage payouts, invite friends, and update your preferences.</p><button className="btn btn-primary" onClick={() => void session.signOut().catch(() => setError("Couldn’t return to sign in. Please reload."))}>Sign in to your account</button></div> : <>
          <div className="account-toolbar"><span>{section === "overview" ? "A little progress, every day." : SECTIONS.find(([id]) => id === section)?.[1]}</span><button type="button" onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
          <div className="account-content" data-section={section} key={revision} onClick={(event) => {
            const link = (event.target as Element).closest('a[href^="#"]');
            if (link) { event.preventDefault(); setSection(accountSection(link.getAttribute("href")?.slice(1))); }
          }}><DashboardBody /></div>
        </>}
      </main>
    </div>
  </div>;
}
