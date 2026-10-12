import Link from "next/link";

export function AdminModelTabs({ active }: { active: "free" | "byok" | "reports" }) {
  return <nav className="admin-toolbar" aria-label="Model catalogs">
    <Link className={`btn${active === "free" ? " btn-primary" : ""}`} href="/admin/tagflow" aria-current={active === "free" ? "page" : undefined}>Free models</Link>
    <Link className={`btn${active === "reports" ? " btn-primary" : ""}`} href="/admin/tagflow/reports" aria-current={active === "reports" ? "page" : undefined}>Provider reports</Link>
    <Link className={`btn${active === "byok" ? " btn-primary" : ""}`} href="/admin/models" aria-current={active === "byok" ? "page" : undefined}>Bring your own key models</Link>
  </nav>;
}
