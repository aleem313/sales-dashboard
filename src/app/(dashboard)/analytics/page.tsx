import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import {
  ModelComparison,
  CountryHeatmap,
  TimeHeatmap,
  BudgetIntelligence,
} from "@/components/charts";
import {
  getProposalAnalytics,
  getCountryStats,
  getBestTimeToApply,
  getBudgetWinRate,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";

export const revalidate = 300;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; agent?: string; profile?: string }>;
}) {
  const params = await searchParams;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;

  const [modelData, countryData, timeData, budgetData, allAgents, allProfiles] = await Promise.all([
    getProposalAnalytics(),
    getCountryStats(),
    getBestTimeToApply(),
    getBudgetWinRate(profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

  return (
    <>
    <Header title="Analytics" agents={allAgents} profiles={allProfiles} />
    <main className="flex-1 overflow-y-auto bg-background">
    <div className="container mx-auto px-4 py-6 space-y-6">

      <Separator />

      <ModelComparison data={modelData} />

      <div className="grid gap-4 md:grid-cols-2">
        <CountryHeatmap data={countryData} />
        <BudgetIntelligence data={budgetData} />
      </div>

      <TimeHeatmap data={timeData} />
    </div>
    </main>
    </>
  );
}
