import Link from "@/components/IntentLink";

export function PortalActions() {
  return (
    <span className="glass-portal-rail" role="group" aria-label="Advertise on ADCode">
      <Link href="/portal" className="glass-portal-button header-advertise">
        <span>Advertise</span><i aria-hidden="true">↗</i>
      </Link>
    </span>
  );
}
