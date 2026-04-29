import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { PipelineKanban } from "@/components/pipeline/pipeline-kanban";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import {
  getPipelineStages,
  getActiveJobsInPipeline,
  getAllAgents,
  getAllProfiles,
} from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 300;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; agent?: string; profile?: string; tz?: string }>;
}) {
  const params = await searchParams;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const range = parseDateRange(params);

  const [stages, jobs, allAgents, allProfiles] = await Promise.all([
    getPipelineStages(range, agentId, profileId),
    getActiveJobsInPipeline(agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

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
      <Header
          title="Pipeline Tracker"
          agents={allAgents}
          profiles={allProfiles}
        />
      <AutoRefresh interval={15000} />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
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
      </main>
    </>
  );
}
