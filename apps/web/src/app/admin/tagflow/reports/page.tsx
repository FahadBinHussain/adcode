import { AdminShell } from "@/components/AdminShell";
import { AdminModelTabs } from "@/components/AdminModelTabs";
import { FreeModelReports } from "@/components/FreeModelReports";

export default function FreeModelReportsPage() {
  return <AdminShell title="Free model provider reports" subtitle="Demand, usage, reliability, performance and feedback for every included model. Download a complete briefing for its provider."><AdminModelTabs active="reports" /><FreeModelReports /></AdminShell>;
}
