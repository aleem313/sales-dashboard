import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { AlertList } from "@/components/alerts/alert-list";
import {
  getActiveAlerts,
  getAlertCounts,
  getSystemHealth,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";

export const revalidate = 300;

export default async function AlertsPage() {
  const [alerts, counts, health, allAgents, allProfiles] = await Promise.all([
    getActiveAlerts(),
    getAlertCounts(),
    getSystemHealth(),
    getAllAgents(),
    getAllProfiles(),
  ]);

  const criticalAlerts = alerts.filter((a) =>
    ["win_rate_drop", "agent_slow", "profile_zero_wins"].includes(a.alert_type)
  );
  const warningAlerts = alerts.filter((a) =>
    ["low_volume", "connect_waste", "follow_up_needed"].includes(a.alert_type)
  );
  const opportunityAlerts = alerts.filter((a) =>
    ["niche_outperform", "bonus_threshold", "filter_recommendation"].includes(
      a.alert_type
    )
  );
  const infoAlerts = alerts.filter(
    (a) =>
      !criticalAlerts.includes(a) &&
      !warningAlerts.includes(a) &&
      !opportunityAlerts.includes(a)
  );

  const healthLabel =
    health.gptFailureRate < 5 && health.lastSyncStatus !== "failed"
      ? "Good"
      : health.gptFailureRate < 20
        ? "Warning"
        : "Critical";

  return (
    <>
      <Header
          title="Alerts & Insights"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard
            label="Active Alerts"
            value={counts.critical}
            variant="danger"
            delta="Require action"
          />
          <StatCard
            label="Warnings"
            value={counts.warning}
            variant="warn"
            delta="Monitor closely"
          />
          <StatCard
            label="Opportunities"
            value={counts.opportunity}
            variant="green"
            delta="Act now"
          />
          <StatCard
            label="Overdue Items"
            value={counts.overdue}
            variant="danger"
            delta="Past SLA"
            deltaDown={counts.overdue > 0}
          />
          <StatCard
            label="System Health"
            value={healthLabel}
            variant={healthLabel === "Good" ? "green" : healthLabel === "Warning" ? "warn" : "danger"}
            delta={`Last sync: ${health.lastSyncStatus ?? "never"}`}
          />
        </StatRow>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-3.5 text-sm font-bold">
              Critical Alerts
            </h3>
            <AlertList
              alerts={criticalAlerts}
              variant="danger"
            />
          </div>
          <div>
            <h3 className="mb-3.5 text-sm font-bold">
              Warnings & Opportunities
            </h3>
            <AlertList alerts={warningAlerts} variant="warn" />
            <div className="mt-3">
              <AlertList alerts={opportunityAlerts} variant="green" />
            </div>
            {infoAlerts.length > 0 && (
              <div className="mt-3">
                <AlertList alerts={infoAlerts} variant="info" />
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
