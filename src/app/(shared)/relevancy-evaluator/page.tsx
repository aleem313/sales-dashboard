import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { getAllAgents, getAllProfiles, listProfilesForManualEval } from "@/lib/data";
import { EvaluatorForm } from "@/components/relevancy-evaluator/evaluator-form";

export const dynamic = "force-dynamic";

interface SearchParams {
  // Allow deep-linking from the audit page or task board:
  //   /relevancy-evaluator?task=<uuid>&profile_id=<slug>
  task?: string;
  profile_id?: string;
}

export default async function RelevancyEvaluatorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [agents, profiles, evalProfiles] = await Promise.all([
    getAllAgents(),
    getAllProfiles(),
    listProfilesForManualEval(),
  ]);

  return (
    <>
      <Header
        title="Relevancy Evaluator"
        agents={agents}
        profiles={profiles}
        hideFilters
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <div className="space-y-1">
            <p className="text-[13px] text-muted-foreground">
              Paste a Task Board card URL and pick a profile to run the
              classifier on demand. Read-only: this does not move the card
              or send anything to Upwork.
            </p>
          </div>

          <Separator />

          <EvaluatorForm
            profiles={evalProfiles}
            initialTaskInput={
              params.task && /^[0-9a-f-]{36}$/i.test(params.task) ? params.task : ""
            }
            initialProfileId={typeof params.profile_id === "string" ? params.profile_id : ""}
          />
        </div>
      </main>
    </>
  );
}
