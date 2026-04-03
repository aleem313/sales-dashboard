import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConnectsUsageBars } from "@/components/connects/connects-usage-bars";
import { ConnectROITable } from "@/components/connects/connect-roi-table";
import { FilterQualityCard } from "@/components/connects/filter-quality";
import { getConnectsUsageByProfile, getConnectROIByNiche, getFilterQualityAnalysis, getAllProfiles } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyConnectsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [usage, roi, filterQuality, allProfiles] = await Promise.all([
    getConnectsUsageByProfile(range, agentId),
    getConnectROIByNiche(range, agentId),
    getFilterQualityAnalysis(range, agentId),
    getAllProfiles(),
  ]);
  const agentProfiles = allProfiles.filter((p) => p.agent_id === agentId);

  const totalUsed = usage.reduce((s, u) => s + u.connects_used, 0);
  const totalWins = roi.reduce((s, r) => s + r.wins, 0);
  const connectsPerWin = totalWins > 0 ? Math.round(totalUsed / totalWins) : 0;
  const wasted = roi.filter((r) => r.wins === 0).reduce((s, r) => s + r.connects_spent, 0);

  return (
    <>
      <Header title="My Connects" profiles={agentProfiles} hideAgentFilter />
      <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <AutoRefresh interval={15000} />

      <StatRow className="mb-5">
        <StatCard label="Total Used" value={totalUsed} variant="accent" delta="Estimated from proposals" />
        <StatCard label="Per Win" value={connectsPerWin} delta="Connects per closed deal" />
        <StatCard label="Wasted" value={wasted} variant="danger" delta="On 0-win niches" />
        <StatCard label="Total Wins" value={totalWins} variant="green" delta="Won jobs" />
      </StatRow>

      <ConnectsUsageBars data={usage} />
      <div className="mt-5">
        <ConnectROITable data={roi} />
      </div>
      <div className="mt-5">
        <FilterQualityCard data={filterQuality} />
      </div>
    </div>
    </>
  );
}
