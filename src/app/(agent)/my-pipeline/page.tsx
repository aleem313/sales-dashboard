import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { PipelineKanban } from "@/components/pipeline/pipeline-kanban";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import { getPipelineStages, getPipelineBucketCounts, getActiveJobsInPipeline, getAllProfiles } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function MyPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; tz?: string; profile?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.agentId) redirect("/my-dashboard");

  const agentId = session.user.agentId;
  const params = await searchParams;
  const range = parseDateRange(params);
  const profileId = params.profile || undefined;

  const [stages, bucketCounts, jobs, allProfiles] = await Promise.all([
    getPipelineStages(range, agentId, profileId),
    getPipelineBucketCounts(agentId, profileId),
    getActiveJobsInPipeline(agentId, profileId),
    getAllProfiles(),
  ]);
  const agentProfiles = allProfiles.filter((p) => p.agent_id === agentId);

  const { todo, submitted, proto, meeting, negotiation } = bucketCounts;

  return (
    <>
      <Header title="My Pipeline" profiles={agentProfiles} hideAgentFilter />
      <div className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <AutoRefresh interval={15000} />

      <StatRow className="mb-5">
        <StatCard label="To Do" value={todo} variant="accent" delta="Awaiting action" />
        <StatCard label="Submitted" value={submitted} delta="Awaiting response" />
        <StatCard label="Prototype" value={proto} variant="warn" delta="In progress" />
        <StatCard label="Meeting Stage" value={meeting} delta="Scheduled / done" />
        <StatCard label="Negotiation" value={negotiation} variant="green" delta="High priority" />
      </StatRow>

      <div className="mb-5">
        <PipelineKanban stages={stages} />
      </div>

      <PipelineTable jobs={jobs} />
    </div>
    </>
  );
}
