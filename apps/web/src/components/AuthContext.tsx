"use client";

import { createContext, useContext } from "react";
import type { User } from "firebase/auth";
import type { ApiError } from "@/lib/api";

export interface AuthState {
  user: User | null;
  loading: boolean;
  configured: boolean;
  token: () => Promise<string | null>;
  isAdmin: boolean;
  /**
   * True while the server is still being asked whether this account is an admin. Signing in
   * finishes first, so without this an administrator was told "Not an admin account" for the
   * moment between the two.
   */
  adminLoading: boolean;
  /**
   * Why the admin question could not be answered, or null when it was. "Not an admin" is
   * an answer; `server-error` or `offline` are not - and the difference matters, because
   * a database outage used to tell the founding administrator she was not one.
   */
  adminError: ApiError | null;
  /** Ask again, after a failure that was not a refusal. */
  retryAdmin: () => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
  token: async () => null,
  isAdmin: false,
  adminLoading: false,
  adminError: null,
  retryAdmin: () => {},
});


export const useAuth = (): AuthState => useContext(AuthContext);
