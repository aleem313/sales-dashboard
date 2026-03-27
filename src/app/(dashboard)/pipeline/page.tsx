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

  // Map each clickup_status to a stat card bucket
  const cardBuckets: Record<string, string> = {
    "to do": "todo",
    "todo": "todo",
    "new": "todo",
    "proposal ready": "todo",
    "proposal submitted": "submitted",
    "submitted": "submitted",
    "sent": "submitted",
    "following up": "submitted",
    "prototype required": "proto",
    "prototype done": "proto",
    "prototype sent": "proto",
    "meeting scheduled": "meeting",
    "meeting done": "meeting",
    "negotiation": "negotiation",
  };

  const counts: Record<string, number> = { todo: 0, submitted: 0, proto: 0, meeting: 0, negotiation: 0 };
  for (const s of stages) {
    const bucket = cardBuckets[s.key.toLowerCase()];
    if (bucket) counts[bucket] += s.count;
  }

  const { todo, submitted, proto, meeting, negotiation } = counts;

  return (
    <>
      <Header
          title="Pipeline Tracker"
          agents={allAgents}
          profiles={allProfiles}
        />
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
