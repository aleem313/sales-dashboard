import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import {
  getSyncLogs,
  getSystemHealth,
  getAllAgents,
  getAllProfiles,
  getAlertHistory,
  getUpworkProfileSnapshotSummaries,
} from "@/lib/data";
import { SyncControls } from "@/components/settings/sync-controls";
import { SyncLogTable } from "@/components/settings/sync-log-table";
import { AgentManagement } from "@/components/settings/agent-management";
import { ProfileManagement } from "@/components/settings/profile-management";
import { AlertThresholds } from "@/components/settings/alert-thresholds";
import { AlertHistory } from "@/components/settings/alert-history";
import { auth } from "@/lib/auth";
import type { SyncLog } from "@/lib/types";

export const revalidate = 0;

export default async function SettingsPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const [syncLogs, systemHealth, agents, profiles, alertHistory, snapshotSummaries] = await Promise.all([
    getSyncLogs(20),
    getSystemHealth(),
    getAllAgents(),
    getAllProfiles(),
    getAlertHistory(50),
    getUpworkProfileSnapshotSummaries(),
  ]);

  return (
    <>
    <Header title="Settings" agents={agents} profiles={profiles} />
    <main className="flex-1 overflow-y-auto bg-background">
    <div className="container mx-auto px-4 py-6 space-y-6">

      <Separator />

      <SyncControls />

      <SyncLogTable logs={syncLogs as SyncLog[]} />

      <AgentManagement agents={agents} profiles={profiles} />

      <ProfileManagement
        profiles={profiles}
        agents={agents}
        snapshotSummaries={snapshotSummaries}
        isAdmin={isAdmin}
      />

      <AlertThresholds />

      <AlertHistory alerts={alertHistory} />
    </div>
    </main>
    </>
  );
}
