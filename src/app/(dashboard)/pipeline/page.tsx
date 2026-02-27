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

export const revalidate = 300;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const days = params.range === "30" ? 30 : params.range === "all" ? 365 * 5 : 7;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const range = { startDate: startDate.toISOString(), endDate: endDate.toISOString() };

  const [stages, jobs, allAgents, allProfiles] = await Promise.all([
    getPipelineStages(range),
    getActiveJobsInPipeline(),
    getAllAgents(),
    getAllProfiles(),
  ]);

  const countFor = (keys: string[]) =>
    stages
      .filter((s) => keys.some((k) => s.key.toLowerCase().includes(k.toLowerCase())))
      .reduce((sum, s) => sum + s.count, 0);

  const todo = countFor(["To Do", "New", "Proposal Ready"]);
  const submitted = countFor(["Submitted", "Sent"]);
  const proto = countFor(["Prototype"]);
  const meeting = countFor(["Meeting"]);
  const negotiation = countFor(["Negotiation"]);

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
