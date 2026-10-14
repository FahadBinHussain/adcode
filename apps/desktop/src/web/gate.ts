/**
 * The web version's front door: sign in, then wait while the workspace wakes.
 *
 * Shown before the renderer loads, in `#web-gate`. Signing in is required, because each person
 * gets a private cloud sandbox and anonymous accounts are free to mint. Google, GitHub and email
 * all use the Firebase project the desktop and the site use, so the same person lands on the
 * same account - and the same earnings - everywhere.
 *
 * In development (`npm run web:vibe`) a dev-mode button skips sign-in; the production build
 * cannot show it (`__ADCODE_WEB_DEV__` is compiled to `false`, pinned by a test).
 */
import { brandMark } from "../renderer/workbench/brandMark.ts";
import { currentUser, firebaseConfigured, idToken, resetPassword, signInWith, signInWithEmail, signOutHere } from "./firebaseAuth.ts";
import { firebaseErrorText } from "./gateText.ts";

declare const __ADCODE_WEB_DEV__: boolean;

export interface WebSession {
  /** A Firebase ID token; "dev" in development mode. */
  readonly token: string | null;
  readonly email: string | null;
  /** A current token, forcing a refresh when asked. */
  refresh(force?: boolean): Promise<string | null>;
  signOut(): Promise<void>;
}

const SITE = "https://adcode.bluethenics.com";

function host(): HTMLElement {
  let element = document.getElementById("web-gate");
  if (element === null) {
    element = document.createElement("div");
    element.id = "web-gate";
    document.body.prepend(element);
  }
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const GOOGLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2.1-2 3.2-4.9 3.2-8.2z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';
const GITHUB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a9.9 9.9 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z"/></svg>';

function shell(): { card: HTMLElement; body: HTMLElement } {
  const root = host();
  root.replaceChildren();
  root.hidden = false;
  root.className = "web-gate";
  const card = element("main", "web-gate-card");
  const brand = element("div", "web-gate-brand");
  brand.append(brandMark({ size: 52, plate: true, accent: true }), element("span", "web-gate-wordmark", "ADCode"));
  const body = element("div", "web-gate-body");
  card.append(brand, body);
  root.append(card);
  return { card, body };
}

/** The sign-in card. Resolves once someone is signed in (or chose dev mode). */
function signInCard(): Promise<"signed-in" | "dev"> {
  return new Promise((resolve) => {
    const { body } = shell();
    const title = element("h1", "web-gate-title", "Build anything by describing it.");
    const lead = element("p", "web-gate-lead", "ADCode's Vibe mode, in your browser. Say what you want; the AI builds it, runs it and shows you, in your own private cloud workspace.");
    const error = element("p", "web-gate-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const showError = (code: unknown): void => {
      const message = firebaseErrorText(typeof code === "string" ? code : null);
      error.textContent = message ?? "";
      error.hidden = message === null;
    };

    const actions = element("div", "web-gate-actions");
    const provider = (label: string, icon: string, which: "google" | "github"): HTMLButtonElement => {
      const button = element("button", "web-gate-button web-gate-provider");
      button.type = "button";
      button.innerHTML = icon;
      button.append(element("span", undefined, label));
      button.addEventListener("click", () => {
        error.hidden = true;
        for (const control of actions.querySelectorAll("button")) control.disabled = true;
        signInWith(which)
          .then(() => resolve("signed-in"))
          .catch((failure: unknown) => {
            showError((failure as { code?: unknown }).code);
            for (const control of actions.querySelectorAll("button")) control.disabled = false;
          });
      });
      return button;
    };

    const available = firebaseConfigured();
    if (available) {
      actions.append(provider("Continue with Google", GOOGLE_ICON, "google"), provider("Continue with GitHub", GITHUB_ICON, "github"));

      const divider = element("div", "web-gate-divider");
      divider.append(element("span", undefined, "or"));

      const form = element("form", "web-gate-email");
      form.noValidate = true;
      const email = element("input", "web-gate-input");
      email.type = "email";
      email.autocomplete = "email";
      email.placeholder = "Email";
      email.setAttribute("aria-label", "Email");
      const password = element("input", "web-gate-input");
      password.type = "password";
      password.autocomplete = "current-password";
      password.placeholder = "Password";
      password.setAttribute("aria-label", "Password");
      let creating = false;
      const submit = element("button", "web-gate-button web-gate-primary", "Sign in with email");
      submit.type = "submit";
      const switcher = element("div", "web-gate-links");
      const toggle = element("button", "web-gate-link", "New here? Create an account");
      toggle.type = "button";
      const forgot = element("button", "web-gate-link", "Forgot password?");
      forgot.type = "button";
      toggle.addEventListener("click", () => {
        creating = !creating;
        submit.textContent = creating ? "Create account" : "Sign in with email";
        toggle.textContent = creating ? "Have an account? Sign in" : "New here? Create an account";
        password.autocomplete = creating ? "new-password" : "current-password";
        forgot.hidden = creating;
      });
      forgot.addEventListener("click", () => {
        const address = email.value.trim();
        if (address.length === 0) {
          error.textContent = "Type your email first, then choose Forgot password.";
          error.hidden = false;
          email.focus();
          return;
        }
        resetPassword(address)
          .then(() => {
            error.textContent = `If ${address} has an account, a reset link is on its way.`;
            error.hidden = false;
          })
          .catch((failure: unknown) => showError((failure as { code?: unknown }).code));
      });
      switcher.append(toggle, forgot);
      form.append(email, password, submit, switcher);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        error.hidden = true;
        submit.disabled = true;
        signInWithEmail(email.value.trim(), password.value, creating)
          .then(() => resolve("signed-in"))
          .catch((failure: unknown) => {
            showError((failure as { code?: unknown }).code);
            submit.disabled = false;
          });
      });
      actions.append(divider, form);
    } else {
      const unavailable = element("p", "web-gate-lead", "Sign-in isn't configured for this build.");
      actions.append(unavailable);
    }

    if (__ADCODE_WEB_DEV__) {
      const dev = element("button", "web-gate-button web-gate-dev", "Continue in dev mode");
      dev.type = "button";
      dev.addEventListener("click", () => resolve("dev"));
      actions.append(dev);
    }

    const fine = element("p", "web-gate-fine");
    fine.append(
      document.createTextNode("60 minutes of cloud time a day, free. Ads keep it free, and you earn a share of them. "),
      Object.assign(element("a", undefined, "Terms"), { href: `${SITE}/terms`, target: "_blank", rel: "noopener" }),
      document.createTextNode(" · "),
      Object.assign(element("a", undefined, "Privacy"), { href: `${SITE}/privacy`, target: "_blank", rel: "noopener" }),
    );

    body.append(title, lead, actions, error, fine);
    body.querySelector<HTMLButtonElement>(".web-gate-provider")?.focus();
  });
}

/** Signs the person in (or reuses a saved session) and returns what the socket needs. */
export async function gate(): Promise<WebSession> {
  const restored = firebaseConfigured() ? await currentUser() : null;
  if (restored === null) {
    const outcome = await signInCard();
    if (outcome === "dev") {
      // "dev" is accepted only by a local Worker started with ALLOW_DEV_TOKEN=1; adcode-host ignores it.
      return { token: "dev", email: null, refresh: async () => "dev", signOut: async () => location.reload() };
    }
  }
  const token = await idToken();
  const user = firebaseConfigured() ? await currentUser() : null;
  return {
    token,
    email: user?.email ?? null,
    refresh: (force = false) => idToken(force),
    signOut: async () => {
      await signOutHere();
      location.reload();
    },
  };
}

/** The waking screen, shown until the sandbox's first greeting. */
export function showWaking(message = "Waking your workspace…", detail = "A few seconds the first time each day."): void {
  const { body } = shell();
  const spinner = element("div", "web-gate-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const status = element("p", "web-gate-title web-gate-title-small", message);
  status.setAttribute("role", "status");
  body.append(spinner, status, element("p", "web-gate-lead", detail));
}

/** A full-screen message with actions: no time left today, the web version is full, and so on. */
export function showBlocked(title: string, detail: string, actions: readonly { label: string; primary?: boolean; run: () => void }[]): void {
  const { body } = shell();
  const heading = element("h1", "web-gate-title", title);
  const lead = element("p", "web-gate-lead", detail);
  const row = element("div", "web-gate-actions");
  for (const action of actions) {
    const button = element("button", `web-gate-button${action.primary === true ? " web-gate-primary" : ""}`, action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    row.append(button);
  }
  body.append(heading, lead, row);
}

export function hideGate(): void {
  const root = host();
  root.hidden = true;
  root.replaceChildren();
}
