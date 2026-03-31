import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { BoardView } from "@/components/tasks/board-view";
import { TaskCreateModal } from "@/components/tasks/task-create-modal";
import { getDefaultProject, getProjectColumns, getProjectTasks } from "@/lib/task-data";

async function BoardContent() {
  const project = await getDefaultProject();
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold">No project found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Run the migration to create the default workspace and project.
          </p>
        </div>
      </div>
    );
  }

  const [columns, tasks] = await Promise.all([
    getProjectColumns(project.id),
    getProjectTasks(project.id),
  ]);

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">{project.name}</h2>
        </div>
        <TaskCreateModal projectId={project.id} columns={columns} />
      </div>
      <BoardView columns={columns} tasks={tasks} />
    </>
  );
}

export default function TasksPage() {
  return (
    <>
      <Header title="Task Board" />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Suspense fallback={<BoardSkeleton />}>
          <BoardContent />
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
            <div className="ml-auto h-5 w-8 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((card) => (
              <div key={card} className="rounded-lg border bg-card p-3">
                <div className="h-3 w-16 rounded bg-muted animate-pulse mb-2" />
                <div className="h-4 w-full rounded bg-muted animate-pulse mb-1" />
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse mb-3" />
                <div className="flex justify-between">
                  <div className="flex -space-x-1">
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
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
