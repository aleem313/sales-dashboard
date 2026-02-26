import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { WinRateTrend, ResponseTimeChart } from "@/components/charts";
import { getAgentWinRateTrend, getResponseTimeDistribution } from "@/lib/data";

export const revalidate = 300;

export default async function MyPerformancePage() {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/dashboard");

  const agentId = session.user.agentId;

  const [winRateTrend, responseTime] = await Promise.all([
    getAgentWinRateTrend(agentId),
    getResponseTimeDistribution(agentId),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Performance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Win rate trends and response time analysis.
        </p>
      </div>

      <Separator />

      <WinRateTrend data={winRateTrend} />

      <ResponseTimeChart data={responseTime} />
    </div>
  );
}
