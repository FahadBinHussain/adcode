/**
 * Signing in on the web version, with the same Firebase project as the desktop and the site.
 *
 * Signing in here with the account the desktop app is linked to means the same uid, so the
 * same earnings balance and the same included-AI allowance. The browser keeps the session; the
 * sandbox only ever sees the short-lived ID token this hands out.
 *
 * The config is compiled in from `apps/web`'s public Firebase settings (see
 * `vite.web.config.ts`). It identifies the project; it authorises nothing.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

declare const __ADCODE_FIREBASE__: { apiKey: string; authDomain: string; projectId: string; appId: string };

export function firebaseConfigured(): boolean {
  return __ADCODE_FIREBASE__.apiKey.length > 0 && __ADCODE_FIREBASE__.projectId.length > 0;
}

function app(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(__ADCODE_FIREBASE__);
}

function auth(): Auth {
  return getAuth(app());
}

/** The signed-in person, once Firebase has restored any saved session. */
export function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth(), (user) => {
      stop();
      resolve(user);
    });
  });
}

export function onUserChanged(listener: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth(), listener);
}

export async function signInWith(provider: "google" | "github"): Promise<User> {
  const chosen = provider === "google" ? new GoogleAuthProvider() : new GithubAuthProvider();
  if (provider === "google") (chosen as GoogleAuthProvider).setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth(), chosen);
  return result.user;
}

export async function signInWithEmail(email: string, password: string, create: boolean): Promise<User> {
  const result = create
    ? await createUserWithEmailAndPassword(auth(), email, password)
    : await signInWithEmailAndPassword(auth(), email, password);
  return result.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth(), email);
}

export async function signOutHere(): Promise<void> {
  await signOut(auth());
}

/** A current ID token for the signed-in person, refreshed by Firebase when it is near expiry. */
export async function idToken(force = false): Promise<string | null> {
  const user = auth().currentUser;
  return user === null ? null : user.getIdToken(force);
}
