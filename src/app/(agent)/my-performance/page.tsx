import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { WinRateTrend, ResponseTimeChart } from "@/components/charts";
import { getAgentWinRateTrend, getResponseTimeDistribution, getAllProfiles } from "@/lib/data";

export const revalidate = 300;

export default async function MyPerformancePage() {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const agentId = session.user.agentId;

  const [winRateTrend, responseTime, allProfiles] = await Promise.all([
    getAgentWinRateTrend(agentId),
    getResponseTimeDistribution(agentId),
    getAllProfiles(),
  ]);
  const agentProfiles = allProfiles.filter((p) => p.agent_id === agentId);

  return (
    <>
      <Header title="My Performance" profiles={agentProfiles} hideAgentFilter />
      <div className="container mx-auto px-4 py-6 space-y-6 flex-1 overflow-y-auto">
        <WinRateTrend data={winRateTrend} />
        <ResponseTimeChart data={responseTime} />
      </div>
    </>
  );
}
