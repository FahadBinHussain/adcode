"use client";

import { WEB_VERSION_URL } from "@/lib/site";
import { useAuth } from "./AuthProvider";
import { AccountMenu } from "./AccountMenu";

/**
 * The account end of the nav.
 *
 * Renders nothing at all until auth resolves, rather than flashing "Sign in" at someone
 * who is already signed in. A nav that changes its mind half a second after paint reads
 * as broken.
 *
 * Signed in, this collapses to one avatar. The three links it used to spell out - Admin,
 * Portal, Earnings - live inside the menu with the sign-out that never had a home, which
 * takes three items out of a nav that has to fit on a phone.
 */
export function NavAccount() {
  const { user, loading, configured } = useAuth();

  if (!configured || loading) return null;

  if (user === null) {
    return (
      <a href={WEB_VERSION_URL} className="nav-signin">
        Sign in
      </a>
    );
  }

  return <AccountMenu />;
}
