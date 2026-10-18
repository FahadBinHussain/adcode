"use client";

import { createContext, useContext } from "react";
import type { User } from "firebase/auth";

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
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
  token: async () => null,
  isAdmin: false,
  adminLoading: false,
});


export const useAuth = (): AuthState => useContext(AuthContext);
