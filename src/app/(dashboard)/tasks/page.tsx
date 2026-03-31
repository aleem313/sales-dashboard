import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { auth } from "@/lib/auth";
import { BoardView } from "@/components/tasks/board-view";
import { TaskCreateModal } from "@/components/tasks/task-create-modal";
import { BoardSelectorWrapper } from "@/components/tasks/board-selector-wrapper";
import { BoardMembersPanel } from "@/components/tasks/board-members-panel";
import {
  getDefaultProject,
  getProjectById,
  getProjectColumns,
  getProjectTasks,
  getAllProjects,
  getUserProjectsWithMeta,
  getProjectMembers,
  getAvailableAgents,
} from "@/lib/task-data";

interface Props {
  searchParams: Promise<{ board?: string }>;
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
  let boardId = params.board;

  // Try localStorage-saved board, then first project, then auto-create
  let project = boardId ? await getProjectById(boardId) : null;
  if (!project && projects.length > 0) {
    project = projects[0];
    boardId = project.id;
  }
  if (!project) {
    project = await getDefaultProject();
    if (project) boardId = project.id;
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold">No boards yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Create your first board to get started."
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

  // Refresh projects list if auto-created
  const finalProjects = projects.length > 0 ? projects : await getAllProjects();

  const [columns, tasks, members, available] = await Promise.all([
    getProjectColumns(project.id),
    getProjectTasks(project.id),
    getProjectMembers(project.id),
    isAdmin ? getAvailableAgents(project.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-2.5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BoardSelectorWrapper
            projects={finalProjects}
            currentProjectId={project.id}
            isAdmin={isAdmin}
          />
          <BoardMembersPanel
            projectId={project.id}
            members={members}
            availableAgents={available}
            isAdmin={isAdmin}
          />
        </div>
        <TaskCreateModal projectId={project.id} columns={columns} />
      </div>
      <BoardView columns={columns} tasks={tasks} />
    </>
  );
}

export default function TasksPage({ searchParams }: Props) {
  return (
    <>
      <Header title="Task Board" />
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
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
      {[1, 2, 3].map((col) => (
        <div key={col} className="w-[280px] shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((card) => (
              <div key={card} className="rounded-lg border bg-card p-3">
                <div className="h-4 w-full rounded bg-muted animate-pulse mb-2" />
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse mb-3" />
                <div className="flex justify-between">
                  <div className="flex -space-x-1">
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                  </div>
                  <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
