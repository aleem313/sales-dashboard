import { Separator } from "@/components/ui/separator";
import { getSyncLogs, getSystemHealth, getAllAgents, getAllProfiles } from "@/lib/data";
import { SyncControls } from "@/components/settings/sync-controls";
import { SyncLogTable } from "@/components/settings/sync-log-table";
import { AgentManagement } from "@/components/settings/agent-management";
import { ProfileManagement } from "@/components/settings/profile-management";
import { AlertThresholds } from "@/components/settings/alert-thresholds";
import type { SyncLog } from "@/lib/types";

export const revalidate = 0;

export default async function SettingsPage() {
  const [syncLogs, systemHealth, agents, profiles] = await Promise.all([
    getSyncLogs(20),
    getSystemHealth(),
    getAllAgents(),
    getAllProfiles(),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Data sync, agent management, and alert configuration.
          {systemHealth.lastSyncAt && (
            <> Last sync: {systemHealth.lastSyncStatus ?? "unknown"}</>
          )}
        </p>
      </div>

      <Separator />

      <SyncControls />

      <SyncLogTable logs={syncLogs as SyncLog[]} />

      <AgentManagement agents={agents} />

      <ProfileManagement profiles={profiles} agents={agents} />

      <AlertThresholds />
    </div>
  );
}
