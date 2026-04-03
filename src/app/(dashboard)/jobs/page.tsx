import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { getJobs, getAllAgents, getAllProfiles } from "@/lib/data";
import { JobFilters } from "@/components/job-filters";
import { JobTable } from "@/components/job-table";
import { JobPagination } from "@/components/job-pagination";
import { parseDateRange } from "@/lib/date-utils";

export const revalidate = 60;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const page = Math.max(1, parseInt(String(params.page ?? "1"), 10) || 1);
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const outcome = typeof params.outcome === "string" ? params.outcome : undefined;
  const budgetType = typeof params.budget_type === "string" ? params.budget_type : undefined;
  const search = typeof params.search === "string" ? params.search : undefined;
  const rangeStr = typeof params.range === "string" ? params.range : undefined;
  const fromStr = typeof params.from === "string" ? params.from : undefined;
  const toStr = typeof params.to === "string" ? params.to : undefined;
  const tzStr = typeof params.tz === "string" ? params.tz : undefined;
  const range = parseDateRange({ range: rangeStr, from: fromStr, to: toStr, tz: tzStr });

  const [jobsResult, agents, profiles] = await Promise.all([
    getJobs({
      agent_id: agentId,
      profile_id: profileId,
      status: status,
      outcome,
      budget_type: budgetType,
      search,
      startDate: range.startDate,
      endDate: range.endDate,
      page,
      limit: 25,
    }),
    getAllAgents(),
    getAllProfiles(),
  ]);

  return (
    <>
    <Header title="Job Feed" agents={agents} profiles={profiles} />
    <main className="flex-1 overflow-y-auto bg-background">
    <div className="container mx-auto px-4 py-6 space-y-6">

      <Separator />

      <JobFilters agents={agents} profiles={profiles} />

      <div className="rounded-md border">
        {jobsResult.data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No jobs match the current filters.
          </div>
        ) : (
          <JobTable jobs={jobsResult.data} />
        )}
      </div>

      <JobPagination
        page={jobsResult.page}
        totalPages={jobsResult.totalPages}
        total={jobsResult.total}
      />
    </div>
    </main>
    </>
  );
}
