import { auth } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { TaskCreateFull } from "@/components/tasks/task-create-full";
import {
  getDefaultProject,
  getProjectById,
  getProjectColumns,
  getProjectMembers,
} from "@/lib/task-data";

interface Props {
  searchParams: Promise<{ board?: string; column?: string }>;
}

export default async function NewTaskPage({ searchParams }: Props) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const params = await searchParams;

  let project = params.board ? await getProjectById(params.board) : null;
  if (!project) project = await getDefaultProject();

  if (!project) {
    return (
      <>
        <Header title="New Task" />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">No project found. Create a board first.</p>
        </main>
      </>
    );
  }

  const [columns, members] = await Promise.all([
    getProjectColumns(project.id),
    getProjectMembers(project.id),
  ]);

  return (
    <>
      <Header title="New Task" />
      <main className="flex-1 overflow-hidden flex flex-col">
        <TaskCreateFull
          projectId={project.id}
          columns={columns}
          members={members}
          defaultColumnId={params.column}
          backUrl={params.board ? `/tasks?board=${params.board}` : "/tasks"}
        />
      </main>
    </>
  );
}
