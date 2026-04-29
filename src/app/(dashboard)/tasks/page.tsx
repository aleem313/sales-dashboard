import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { BoardView } from "@/components/tasks/board-view";
import { BoardHeader } from "@/components/tasks/board-header";
import { BoardSelectorWrapper } from "@/components/tasks/board-selector-wrapper";
// TaskDetailDrawer replaced by full-page /tasks/[id] route
import { BoardFilterBar } from "@/components/tasks/board-filter-bar";
import { BoardStoreInitializer } from "@/components/tasks/board-store-initializer";
import { BoardAutoRefresh } from "@/components/tasks/board-auto-refresh";
import {
  getDefaultProject,
  getProjectById,
  getProjectColumns,
  getProjectColumnsTasksPaged,
  getAllProjects,
  getUserProjectsWithMeta,
  getProjectMembers,
  getAvailableAgents,
  getProjectTags,
  getCustomFieldDefinitions,
  getSavedViews,
} from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, firstSearchParam, INITIAL_PER_COLUMN } from "@/lib/board-filters";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function BoardContent({ searchParams }: Props) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const agentId = session?.user?.agentId;

  // Load all accessible projects
  const projects = isAdmin
    ? await getAllProjects()
    : agentId
      ? await getUserProjectsWithMeta(agentId)
      : [];

  // Determine active board
  const params = await searchParams;
  const boardParam = firstSearchParam(params, "board");
  let project = boardParam ? await getProjectById(boardParam) : null;
  if (!project && projects.length > 0) {
    project = projects[0];
  }
  if (!project) {
    project = await getDefaultProject();
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold">No boards yet</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {isAdmin
              ? "Create your first task board to start managing work."
              : "No boards have been assigned to you. Contact your admin."}
          </p>
          {isAdmin && (
            <BoardSelectorWrapper
              projects={[]}
              currentProjectId=""
              isAdmin={true}
              showCreateOnly
            />
          )}
        </div>
      </div>
    );
  }

  const finalProjects = projects.length > 0 ? projects : await getAllProjects();

  const filters = parseBoardFiltersFromSearchParams(params);

  const [columns, paged, members, available, tags, customFields, savedViews] = await Promise.all([
    getProjectColumns(project.id),
    getProjectColumnsTasksPaged(project.id, filters, INITIAL_PER_COLUMN),
    getProjectMembers(project.id),
    isAdmin ? getAvailableAgents(project.id) : Promise.resolve([]),
    getProjectTags(project.id),
    getCustomFieldDefinitions(project.id),
    getSavedViews(project.id),
  ]);

  return (
    <>
      <BoardStoreInitializer customFields={customFields} savedViews={savedViews} />
      <BoardHeader
        project={project}
        projects={finalProjects}
        columns={columns}
        members={members}
        availableAgents={available}
        isAdmin={isAdmin}
        customFields={customFields}
      />
      <BoardFilterBar columns={columns} members={members} tags={tags} customFields={customFields} />
      <BoardView
        columns={columns}
        buckets={paged.buckets}
        projectId={project.id}
        members={members}
        isAdmin={isAdmin}
        agentId={agentId}
        customFields={customFields}
      />
    </>
  );
}

export default function TasksPage({ searchParams }: Props) {
  return (
    <>
      <Header title="Task Board" />
      <BoardAutoRefresh interval={5000} runInBackground />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Suspense fallback={<BoardSkeleton />}>
          <BoardContent searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

function BoardSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-2.5 gap-3 bg-card/50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-[200px] rounded bg-muted animate-pulse" />
          <div className="flex -space-x-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 w-6 rounded-full bg-muted animate-pulse ring-2 ring-card" />
            ))}
          </div>
        </div>
        <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      </div>
      <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
        {[1, 2, 3, 4].map((col) => (
          <div key={col} className="w-[280px] shrink-0">
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
              <div className="h-4 w-20 rounded bg-muted animate-pulse" />
              <div className="ml-auto h-5 w-6 rounded-full bg-muted animate-pulse" />
            </div>
            <div className="space-y-2">
              {[1, 2].map((card) => (
                <div key={card} className="rounded-lg border bg-card p-3">
                  <div className="h-4 w-full rounded bg-muted animate-pulse mb-2" />
                  <div className="h-4 w-2/3 rounded bg-muted animate-pulse mb-3" />
                  <div className="flex justify-between">
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-10 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
