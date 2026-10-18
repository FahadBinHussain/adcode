"use client";

import { AppShell, type SideNavGroup } from "@/components/AppShell";
import { DashboardBody } from "@/components/DashboardBody";
import { WEB_VERSION_URL } from "@/lib/site";

/**
 * The dashboard is one long workspace too: balance, then earnings, payouts, activity
 * and the ledger. The rail on the left names those destinations - on a laptop it is
 * always on screen, on a phone it opens as a sheet from the sidebar icon.
 */
const DASHBOARD_SIDEBAR: SideNavGroup[] = [
  {
    label: "Account",
    items: [
      { href: "/dashboard", label: "Overview", icon: "grid" },
      { href: "/dashboard#earnings", label: "Earnings", icon: "chart" },
      { href: "/dashboard#invites", label: "Invites", icon: "person" },
      { href: "/dashboard#payouts", label: "Payouts", icon: "send" },
      { href: "/dashboard#activity", label: "Activity", icon: "clock" },
      { href: "/dashboard#ledger", label: "Ledger", icon: "list" },
      { href: "/dashboard#email-preferences", label: "Email preferences", icon: "send" },
    ],
  },
];

export default function Dashboard() {
  return (
    <AppShell
      title="Your account"
      subtitle="Earnings, activity, and every entry behind them"
      sidebar={DASHBOARD_SIDEBAR}
    >
      <div className="notice" data-tone="info">Your account is now part of ADCode. <a href={`${WEB_VERSION_URL}/?account=overview`}>Open your workspace →</a></div>
      <DashboardBody />
    </AppShell>
  );
}
