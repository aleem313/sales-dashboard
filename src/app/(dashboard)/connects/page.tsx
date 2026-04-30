import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ConnectsUsageBars } from "@/components/connects/connects-usage-bars";
import { ConnectROITable } from "@/components/connects/connect-roi-table";
import { FilterQualityCard } from "@/components/connects/filter-quality";
import { ConnectsPurchaseForm } from "@/components/connects/connects-purchase-form";
import {
  getConnectsUsageByProfile,
  getConnectROIByNiche,
  getFilterQualityAnalysis,
  getBoostedConnectsSummary,
  getConnectsBudgetSummary,
  getConnectsPurchasesByProfile,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function ConnectsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; agent?: string; profile?: string; tz?: string }>;
}) {
  const params = await searchParams;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const range = parseDateRange(params);

  const [usage, roi, filterQuality, boosted, budget, purchases, allAgents, allProfiles] = await Promise.all([
    getConnectsUsageByProfile(range, agentId, profileId),
    getConnectROIByNiche(range, agentId, profileId),
    getFilterQualityAnalysis(range, agentId, profileId),
    getBoostedConnectsSummary(range, agentId, profileId),
    getConnectsBudgetSummary(range, agentId, profileId),
    getConnectsPurchasesByProfile(profileId ? [profileId] : undefined, range, 200),
    getAllAgents(),
    getAllProfiles(),
  ]);

  const totalUsed = boosted.totalConnectsUsed;
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
      <AutoRefresh interval={15000} />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard label="Connects Purchased" value={budget.totalConnectsPurchased} variant="accent" delta="Logged this period" />
          <StatCard label="Spend ($)" value={budget.totalSpentUsd.toFixed(2)} variant="accent" delta="On connects this period" />
          <StatCard label="Total Connects Used" value={totalUsed} variant="warn" delta="This period" />
          <StatCard label="Boosted Connects" value={boosted.totalBoosted} variant="accent" delta="All boosted" />
          <StatCard label="Bid out Boost" value={boosted.bidOutBoost} variant="accent" delta="Boosted + labeled" />
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
          <ConnectsPurchaseForm profiles={allProfiles} purchases={purchases} isAdmin />
        </div>

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
