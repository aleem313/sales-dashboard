import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { BoardView } from "@/components/tasks/board-view";
import { BoardSelector } from "@/components/tasks/board-selector";
import { Badge } from "@/components/ui/badge";
import { KanbanSquare } from "lucide-react";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import {
  getDefaultProject,
  getProjectById,
  getProjectColumns,
  getProjectMembers,
  getAgentTasksAcrossBoards,
  getProjectColumnsTasksPaged,
  getUserProjectsWithMeta,
  getCustomFieldDefinitions,
  getProjectTags,
  getSavedViews,
} from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, firstSearchParam, INITIAL_PER_COLUMN } from "@/lib/board-filters";
import { getAgentById } from "@/lib/data";
import { BoardStoreInitializer } from "@/components/tasks/board-store-initializer";
import { BoardFilterBar } from "@/components/tasks/board-filter-bar";
import { BoardAutoRefresh } from "@/components/tasks/board-auto-refresh";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function AgentBoardContent({ searchParams }: Props) {
  const session = await auth();
  const agentId = session?.user?.agentId;
  if (!agentId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Not logged in as an agent.</p>
      </div>
    );
  }

  const projects = await getUserProjectsWithMeta(agentId);

  // Determine active board from URL param or first assigned
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
        <div className="text-center space-y-2">
          <KanbanSquare className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <h2 className="text-lg font-semibold">No boards assigned</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Contact your admin to be added to a task board.
          </p>
        </div>
      </div>
    );
  }

  const filters = parseBoardFiltersFromSearchParams(params);

  const [paged, columns, members, customFields, agentData, tags, savedViews, allTasks] = await Promise.all([
    getProjectColumnsTasksPaged(project.id, filters, INITIAL_PER_COLUMN, {
      agentId,
      agentScopeOnCurrentBoard: true,
    }),
    getProjectColumns(project.id),
    getProjectMembers(project.id),
    getCustomFieldDefinitions(project.id),
    getAgentById(agentId),
    getProjectTags(project.id),
    getSavedViews(project.id),
    getAgentTasksAcrossBoards(agentId, project.id),
  ]);

  const totalOnBoard = Object.values(paged.buckets).reduce((sum, b) => sum + b.totalCount, 0);
  const hasMultipleBoards = projects.length > 1;

  // Build agent-scoped data for header (agent sees only themselves + their profiles)
  const agentForHeader = agentData ? [agentData as import("@/lib/types").Agent] : [];
  const profilesForHeader = agentData?.profiles ?? [];

  return (
    <>
      <Header title="Task Board" agents={agentForHeader} profiles={profilesForHeader} hideFilters hideDatePicker />
      {/* Board header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 bg-card/50">
        <div className="flex items-center gap-3">
          <KanbanSquare className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Board selector — shown when agent has 2+ boards */}
          {hasMultipleBoards ? (
            <AgentBoardSelector projects={projects} currentProjectId={project.id} />
          ) : (
            <h2 className="text-sm font-semibold">{project.name}</h2>
          )}

          <Badge variant="secondary" className="text-[11px] font-normal shrink-0">
            {totalOnBoard} task{totalOnBoard !== 1 ? "s" : ""}
          </Badge>

          {hasMultipleBoards && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {allTasks.length} total across {projects.length} boards
            </span>
          )}
        </div>
        <NewTaskButton projectId={project.id} columns={columns} members={members} />
      </div>
      <BoardStoreInitializer customFields={customFields} savedViews={savedViews} />
      <BoardFilterBar columns={columns} members={members} tags={tags} customFields={customFields} />
      <BoardView
        columns={columns}
        buckets={paged.buckets}
        projectId={project.id}
        members={members}
        agentId={agentId}
        customFields={customFields}
      />
    </>
  );
}

/** Thin client wrapper for agent board switching */
function AgentBoardSelector({ projects, currentProjectId }: { projects: { id: string; name: string; task_count?: number; member_count?: number }[]; currentProjectId: string }) {
  return (
    <BoardSelector
      projects={projects as import("@/lib/task-data").ProjectWithMeta[]}
      currentProjectId={currentProjectId}
      isAdmin={false}
      basePath="/my-tasks"
    />
  );
}

export default function MyTasksPage({ searchParams }: Props) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* realtime: SSE stream fires the new-task bell instantly on card creation,
          focus-independent (works while the agent is in Upwork in another tab).
          runInBackground keeps the polling fallback alive when the tab is hidden,
          in case the SSE stream drops. */}
      <BoardAutoRefresh interval={5000} runInBackground realtime />
      <Suspense
        fallback={
          <>
            <div className="flex items-center justify-between border-b px-4 py-2.5 bg-card/50">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-8 w-24 rounded bg-muted animate-pulse" />
            </div>
            <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
              {[1, 2, 3].map((col) => (
                <div key={col} className="w-[280px] shrink-0">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    {[1, 2].map((card) => (
                      <div key={card} className="h-24 rounded-lg border bg-card animate-pulse" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        }
      >
        <AgentBoardContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
