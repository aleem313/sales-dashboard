import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { ModelComparison, CountryHeatmap, TimeHeatmap, BudgetIntelligence } from "@/components/charts";
import { getProposalAnalytics, getCountryStats, getBestTimeToApply, getBudgetWinRate } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);

  const [modelData, countryData, timeData, budgetData] = await Promise.all([
    getProposalAnalytics(range, agentId),
    getCountryStats(range, agentId),
    getBestTimeToApply(range, agentId),
    getBudgetWinRate(undefined, agentId),
  ]);

  return (
    <>
      <Header title="My Analytics" hideFilters />
      <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <AutoRefresh interval={15000} />

      <div className="grid gap-6">
        <ModelComparison data={modelData} />
        <div className="grid gap-6 lg:grid-cols-2">
          <CountryHeatmap data={countryData} />
          <TimeHeatmap data={timeData} />
        </div>
        <BudgetIntelligence data={budgetData} />
      </div>
    </div>
    </>
  );
}
