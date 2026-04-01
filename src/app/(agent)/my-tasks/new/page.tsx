import { auth } from "@/lib/auth";
import { TaskCreateFull } from "@/components/tasks/task-create-full";
import {
  getDefaultProject,
  getProjectColumns,
  getProjectMembers,
  getUserProjectsWithMeta,
} from "@/lib/task-data";

interface Props {
  searchParams: Promise<{ board?: string; column?: string }>;
}

export default async function AgentNewTaskPage({ searchParams }: Props) {
  const session = await auth();
  const agentId = session?.user?.agentId;
  const params = await searchParams;

  const projects = agentId ? await getUserProjectsWithMeta(agentId) : [];
  let project = params.board
    ? projects.find((p) => p.id === params.board) ?? null
    : projects[0] ?? null;
  if (!project) project = await getDefaultProject();

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">No project found. Contact your admin.</p>
      </div>
    );
  }

  const [columns, members] = await Promise.all([
    getProjectColumns(project.id),
    getProjectMembers(project.id),
  ]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center border-b px-6 py-3 bg-card/50">
        <h1 className="text-lg font-semibold">New Task</h1>
      </div>
      <TaskCreateFull
        projectId={project.id}
        columns={columns}
        members={members}
        defaultColumnId={params.column}
        backUrl={params.board ? `/my-tasks?board=${params.board}` : "/my-tasks"}
      />
    </div>
  );
}
