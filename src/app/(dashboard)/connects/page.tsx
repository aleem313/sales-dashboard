import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConnectsUsageBars } from "@/components/connects/connects-usage-bars";
import { ConnectROITable } from "@/components/connects/connect-roi-table";
import { FilterQualityCard } from "@/components/connects/filter-quality";
import {
  getConnectsUsageByProfile,
  getConnectROIByNiche,
  getFilterQualityAnalysis,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";

export const revalidate = 300;

export default async function ConnectsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; agent?: string; profile?: string }>;
}) {
  const params = await searchParams;
  const days = params.range === "30" ? 30 : params.range === "all" ? 365 * 5 : 7;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const range = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };

  const [usage, roi, filterQuality, allAgents, allProfiles] = await Promise.all([
    getConnectsUsageByProfile(range, agentId, profileId),
    getConnectROIByNiche(range, agentId, profileId),
    getFilterQualityAnalysis(range, agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

  const totalUsed = usage.reduce((s, u) => s + u.connects_used, 0);
  const totalWins = roi.reduce((s, r) => s + r.wins, 0);
  const connectsPerWin = totalWins > 0 ? Math.round(totalUsed / totalWins) : 0;

  // Wasted = connects on niches with 0 wins
  const wasted = roi
    .filter((r) => r.wins === 0)
    .reduce((s, r) => s + r.connects_spent, 0);

  const mostEfficient = [...usage].sort((a, b) => {
    const ra = roi.find((r) => r.niche === a.niche);
    const rb = roi.find((r) => r.niche === b.niche);
    return (ra?.cost_per_win ?? Infinity) - (rb?.cost_per_win ?? Infinity);
  })[0];

  const leastEfficient = [...usage].sort((a, b) => {
    const ra = roi.find((r) => r.niche === a.niche);
    const rb = roi.find((r) => r.niche === b.niche);
    return (rb?.cost_per_win ?? Infinity) - (ra?.cost_per_win ?? Infinity);
  })[0];

  return (
    <>
      <Header
          title="Connect Efficiency"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard label="Total Connects Used" value={totalUsed} variant="warn" delta="This period" />
          <StatCard label="Connects per Win" value={connectsPerWin || "—"} delta={connectsPerWin > 0 ? "Improving" : ""} />
          <StatCard label="Wasted Connects" value={wasted} variant="danger" delta="Low-quality jobs" deltaDown />
          <StatCard
            label="Most Efficient"
            value={mostEfficient?.profile_name || "—"}
            variant="green"
          />
          <StatCard
            label="Least Efficient"
            value={leastEfficient?.profile_name || "—"}
            variant="danger"
          />
        </StatRow>

        <div className="mb-5">
          <ConnectsUsageBars data={usage} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ConnectROITable data={roi} />
          <FilterQualityCard data={filterQuality} />
        </div>
      </main>
    </>
  );
}
