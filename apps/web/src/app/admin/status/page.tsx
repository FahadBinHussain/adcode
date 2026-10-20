"use client";

import { AdminShell } from "@/components/AdminShell";
import { StatusBody } from "../_sections/Status";

/**
 * Incidents for the public status page.
 *
 * A page of its own rather than a tab under Content: this is written during an outage, by
 * somebody who is already in the admin panel, and it should be one click from the sidebar
 * with nothing else competing for attention on it.
 */
export default function AdminStatusPage() {
  return (
    <AdminShell
      title="Status page"
      subtitle="Incidents and updates, published to the public status page and its feed the moment you post them."
    >
      <StatusBody />
    </AdminShell>
  );
}
