import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { PipelineKanban } from "@/components/pipeline/pipeline-kanban";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import { getPipelineStages, getActiveJobsInPipeline, getAllProfiles } from "@/lib/data";
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

  const [stages, jobs, allProfiles] = await Promise.all([
    getPipelineStages(range, agentId, profileId),
    getActiveJobsInPipeline(agentId, profileId),
    getAllProfiles(),
  ]);
  const agentProfiles = allProfiles.filter((p) => p.agent_id === agentId);

  // Bucket counts derived from cumulative first-entry stage counts so the cards
  // and the kanban below stay consistent under the same date filter.
  const stageCount = new Map(stages.map((s) => [s.key, s.count]));
  const todo = stageCount.get("Todo") ?? 0;
  const submitted = stageCount.get("Proposal Submitted") ?? 0;
  const proto = stageCount.get("Prototype Required") ?? 0;
  const meeting = stageCount.get("Meeting Scheduled") ?? 0;
  const negotiation = stageCount.get("Negotiation") ?? 0;

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
