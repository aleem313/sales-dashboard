import { sql } from "@/lib/db";

// Fix activity_log trigger to allow DELETE (migration 007 may not have been applied)
async function fixActivityLogTrigger() {
  await sql`
    CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'activity_log is append-only: UPDATE operations are not allowed';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql
  `;
}

// ============================================================
// TYPES
// ============================================================

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardColumn {
  id: string;
  project_id: string;
  name: string;
  position: number;
  color: string;
  is_done: boolean;
  wip_limit: number | null;
  created_at: string;
  task_count?: number;
}

export interface Task {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  due_date: string | null;
  start_date: string | null;
  position: number;
  creator_id: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined fields
  assignees?: TaskAssignee[];
  tags?: TaskTag[];
  checklist_items?: ChecklistItem[];
  checklist_total?: number;
  checklist_done?: number;
  comment_count?: number;
  attachment_count?: number;
  column_name?: string;
  creator_name?: string | null;
  prev_column_name?: string | null;
  /** Most recent task_moved activity_log timestamp; falls back to created_at when no moves recorded. */
  last_status_at?: string | null;
}

export interface TaskAssignee {
  agent_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
}

export interface TaskTag {
  id: string;
  name: string;
  color: string;
}

export interface CustomFieldDefinition {
  id: string;
  project_id: string;
  name: string;
  field_type: "text" | "number" | "dropdown" | "multi_select" | "date" | "boolean";
  options: string[] | null;
  required: boolean;
  position: number;
  archived: boolean;
  show_on_card: boolean;
  created_at: string;
}

export interface SavedView {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
  created_at: string;
  owner_name?: string;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  title: string;
  is_checked: boolean;
  position: number;
  created_at: string;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  author_name: string;
  author_avatar: string | null;
  reply_count?: number;
}

export interface ActivityLogEntry {
  id: string;
  task_id: string;
  actor_id: string | null;
  actor_label: string;
  action_type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
  actor_avatar?: string | null;
}

export interface ProjectMember {
  agent_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  joined_at: string;
  active: boolean;
}

export interface ProjectWithMeta extends Project {
  task_count?: number;
  member_count?: number;
}

export interface TaskFilters {
  column_id?: string;
  assignee_id?: string;
  priority?: string;
  search?: string;
  due_before?: string;
  due_after?: string;
  tag_id?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}

// ============================================================
// WORKSPACE & PROJECT QUERIES
// ============================================================

export async function getDefaultWorkspace(): Promise<Workspace | null> {
  const result = await sql`
    SELECT * FROM workspaces WHERE slug = 'rising-lion' LIMIT 1
  `;
  return result.rows[0] as Workspace | null ?? null;
}

export async function getDefaultProject(): Promise<Project | null> {
  const result = await sql`
    SELECT p.* FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE w.slug = 'rising-lion'
    ORDER BY p.created_at ASC
    LIMIT 1
  `;
  if (result.rows.length > 0) return result.rows[0] as Project;

  // Auto-create if tables exist but seed was skipped (e.g. no admin agent in DB)
  return await ensureDefaultProject();
}

async function ensureDefaultProject(): Promise<Project | null> {
  // Check if workspaces table exists
  const tableCheck = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'workspaces'
    ) AS exists
  `;
  if (!tableCheck.rows[0]?.exists) return null;

  // Find any agent to be the owner (prefer admin role, fall back to any)
  let ownerId: string | null = null;
  const adminAgent = await sql`SELECT id FROM agents WHERE role = 'admin' LIMIT 1`;
  if (adminAgent.rows.length > 0) {
    ownerId = adminAgent.rows[0].id as string;
  } else {
    const anyAgent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (anyAgent.rows.length > 0) {
      ownerId = anyAgent.rows[0].id as string;
    }
  }
  if (!ownerId) return null;

  // Create workspace
  const wsResult = await sql`
    INSERT INTO workspaces (name, slug, owner_id)
    VALUES ('Rising Lion', 'rising-lion', ${ownerId})
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  `;
  let workspaceId: string;
  if (wsResult.rows.length > 0) {
    workspaceId = wsResult.rows[0].id as string;
  } else {
    const existing = await sql`SELECT id FROM workspaces WHERE slug = 'rising-lion'`;
    if (existing.rows.length === 0) return null;
    workspaceId = existing.rows[0].id as string;
  }

  // Create project
  const projResult = await sql`
    INSERT INTO projects (workspace_id, name, description)
    VALUES (${workspaceId}, 'Task Board', 'Default task management board')
    RETURNING id
  `;
  const projectId = projResult.rows[0].id as string;

  // Add all active agents as members
  const agents = await sql`SELECT id, role FROM agents WHERE active = true`;
  for (const agent of agents.rows) {
    await sql`
      INSERT INTO project_members (project_id, agent_id, role)
      VALUES (${projectId}, ${agent.id}, ${agent.role === 'admin' ? 'admin' : 'member'})
      ON CONFLICT (project_id, agent_id) DO NOTHING
    `;
  }

  // Create default columns (13 Upwork workflow statuses)
  const defaultColumns = [
    { name: 'Todo', position: 1000, color: '#6b7280', is_done: false },
    { name: 'Proposal Submitted', position: 2000, color: '#3b82f6', is_done: false },
    { name: 'Prototype Required', position: 3000, color: '#eab308', is_done: false },
    { name: 'Prototype Done', position: 4000, color: '#22c55e', is_done: false },
    { name: 'Prototype Submitted', position: 5000, color: '#14b8a6', is_done: false },
    { name: 'In Chat', position: 6000, color: '#8b5cf6', is_done: false },
    { name: 'Meeting Scheduled', position: 7000, color: '#6366f1', is_done: false },
    { name: 'Meeting Done', position: 8000, color: '#06b6d4', is_done: false },
    { name: 'Negotiation', position: 9000, color: '#f97316', is_done: false },
    { name: 'Lost', position: 10000, color: '#ef4444', is_done: false },
    { name: 'On Hold', position: 11000, color: '#f59e0b', is_done: false },
    { name: 'N/A', position: 12000, color: '#9ca3af', is_done: false },
    { name: 'Won', position: 13000, color: '#10b981', is_done: true },
  ];
  for (const col of defaultColumns) {
    await sql`
      INSERT INTO columns (project_id, name, position, color, is_done)
      VALUES (${projectId}, ${col.name}, ${col.position}, ${col.color}, ${col.is_done})
    `;
  }

  // Return the created project
  const project = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  return project.rows[0] as Project;
}

export async function getUserProjects(agentId: string): Promise<Project[]> {
  const result = await sql`
    SELECT p.* FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.agent_id = ${agentId}
    ORDER BY p.created_at ASC
  `;
  return result.rows as Project[];
}

export async function isProjectMember(projectId: string, agentId: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM project_members
    WHERE project_id = ${projectId} AND agent_id = ${agentId}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

export async function getProjectMemberRole(projectId: string, agentId: string): Promise<string | null> {
  const result = await sql`
    SELECT role FROM project_members
    WHERE project_id = ${projectId} AND agent_id = ${agentId}
    LIMIT 1
  `;
  return result.rows[0]?.role ?? null;
}

// ============================================================
// PROJECT (BOARD) CRUD
// ============================================================

export async function getAllProjects(): Promise<ProjectWithMeta[]> {
  const result = await sql`
    SELECT p.*,
      (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS task_count,
      (SELECT COUNT(*)::int FROM project_members WHERE project_id = p.id) AS member_count
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE w.slug = 'rising-lion'
    ORDER BY p.created_at ASC
  `;
  return result.rows as ProjectWithMeta[];
}

export async function getUserProjectsWithMeta(agentId: string): Promise<ProjectWithMeta[]> {
  const result = await sql`
    SELECT p.*,
      (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS task_count,
      (SELECT COUNT(*)::int FROM project_members WHERE project_id = p.id) AS member_count
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.agent_id = ${agentId}
    ORDER BY p.created_at ASC
  `;
  return result.rows as ProjectWithMeta[];
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const result = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  return (result.rows[0] as Project) ?? null;
}

export async function createProject(data: {
  name: string;
  description?: string | null;
  creator_id: string;
}): Promise<Project> {
  // Get default workspace
  let ws = await sql`SELECT id FROM workspaces WHERE slug = 'rising-lion' LIMIT 1`;
  if (ws.rows.length === 0) {
    // Create workspace with creator as owner
    ws = await sql`
      INSERT INTO workspaces (name, slug, owner_id)
      VALUES ('Rising Lion', 'rising-lion', ${data.creator_id})
      ON CONFLICT (slug) DO UPDATE SET name = 'Rising Lion'
      RETURNING id
    `;
  }
  const workspaceId = ws.rows[0].id as string;

  const result = await sql`
    INSERT INTO projects (workspace_id, name, description)
    VALUES (${workspaceId}, ${data.name}, ${data.description ?? null})
    RETURNING *
  `;
  const project = result.rows[0] as Project;

  // Add creator as admin member
  await sql`
    INSERT INTO project_members (project_id, agent_id, role)
    VALUES (${project.id}, ${data.creator_id}, 'admin')
    ON CONFLICT (project_id, agent_id) DO NOTHING
  `;

  // Create default columns (13 Upwork workflow statuses)
  const defaultColumns = [
    { name: 'Todo', position: 1000, color: '#6b7280', is_done: false },
    { name: 'Proposal Submitted', position: 2000, color: '#3b82f6', is_done: false },
    { name: 'Prototype Required', position: 3000, color: '#eab308', is_done: false },
    { name: 'Prototype Done', position: 4000, color: '#22c55e', is_done: false },
    { name: 'Prototype Submitted', position: 5000, color: '#14b8a6', is_done: false },
    { name: 'In Chat', position: 6000, color: '#8b5cf6', is_done: false },
    { name: 'Meeting Scheduled', position: 7000, color: '#6366f1', is_done: false },
    { name: 'Meeting Done', position: 8000, color: '#06b6d4', is_done: false },
    { name: 'Negotiation', position: 9000, color: '#f97316', is_done: false },
    { name: 'Lost', position: 10000, color: '#ef4444', is_done: false },
    { name: 'On Hold', position: 11000, color: '#f59e0b', is_done: false },
    { name: 'N/A', position: 12000, color: '#9ca3af', is_done: false },
    { name: 'Won', position: 13000, color: '#10b981', is_done: true },
  ];
  for (const col of defaultColumns) {
    await sql`
      INSERT INTO columns (project_id, name, position, color, is_done)
      VALUES (${project.id}, ${col.name}, ${col.position}, ${col.color}, ${col.is_done})
    `;
  }

  return project;
}

export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string | null }
): Promise<Project | null> {
  const result = await sql`
    UPDATE projects SET
      name = COALESCE(${fields.name ?? null}, name),
      description = ${fields.description !== undefined ? (fields.description ?? null) : null}
    WHERE id = ${projectId}
    RETURNING *
  `;
  return (result.rows[0] as Project) ?? null;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  // Delete activity_log entries first — trigger may block DELETE if migration 007 not applied
  try {
    await sql`
      DELETE FROM activity_log
      WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ${projectId})
    `;
  } catch {
    // Trigger blocks DELETE — apply migration 007 fix inline, then retry
    await fixActivityLogTrigger();
    await sql`
      DELETE FROM activity_log
      WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ${projectId})
    `;
  }
  // CASCADE handles tasks, columns, members, tags, etc.
  const result = await sql`DELETE FROM projects WHERE id = ${projectId}`;
  return (result.rowCount ?? 0) > 0;
}

export async function getProjectTaskCount(projectId: string): Promise<number> {
  const result = await sql`SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = ${projectId}`;
  return result.rows[0].count as number;
}

// ============================================================
// PROJECT MEMBER MANAGEMENT
// ============================================================

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const result = await sql`
    SELECT a.id AS agent_id, a.name, a.email, a.avatar_url, a.active,
           pm.role, pm.joined_at
    FROM project_members pm
    JOIN agents a ON a.id = pm.agent_id
    WHERE pm.project_id = ${projectId}
    ORDER BY
      CASE pm.role WHEN 'admin' THEN 0 ELSE 1 END,
      a.name ASC
  `;
  return result.rows as unknown as ProjectMember[];
}

export async function addProjectMembers(
  projectId: string,
  agentIds: string[],
  role: "admin" | "member" = "member"
): Promise<number> {
  let added = 0;
  for (const agentId of agentIds) {
    // Validate agent is active
    const agent = await sql`SELECT id FROM agents WHERE id = ${agentId} AND active = true`;
    if (agent.rows.length === 0) continue;

    const result = await sql`
      INSERT INTO project_members (project_id, agent_id, role)
      VALUES (${projectId}, ${agentId}, ${role})
      ON CONFLICT (project_id, agent_id) DO NOTHING
    `;
    if ((result.rowCount ?? 0) > 0) added++;
  }
  return added;
}

export async function updateMemberRole(
  projectId: string,
  agentId: string,
  newRole: "admin" | "member"
): Promise<{ success: boolean; error?: string }> {
  // Block demoting last admin
  if (newRole === "member") {
    const adminCount = await sql`
      SELECT COUNT(*)::int AS count FROM project_members
      WHERE project_id = ${projectId} AND role = 'admin'
    `;
    if ((adminCount.rows[0].count as number) <= 1) {
      // Check if this agent IS the last admin
      const isAdmin = await sql`
        SELECT 1 FROM project_members
        WHERE project_id = ${projectId} AND agent_id = ${agentId} AND role = 'admin'
      `;
      if (isAdmin.rows.length > 0) {
        return { success: false, error: "Cannot demote the last admin" };
      }
    }
  }

  await sql`
    UPDATE project_members SET role = ${newRole}
    WHERE project_id = ${projectId} AND agent_id = ${agentId}
  `;
  return { success: true };
}

export async function removeProjectMember(
  projectId: string,
  agentId: string,
  unassignTasks: boolean = false
): Promise<{ success: boolean; error?: string; assignedTaskCount?: number }> {
  // Check if workspace owner
  const ownerCheck = await sql`
    SELECT w.owner_id FROM workspaces w
    JOIN projects p ON p.workspace_id = w.id
    WHERE p.id = ${projectId}
  `;
  if (ownerCheck.rows.length > 0 && ownerCheck.rows[0].owner_id === agentId) {
    return { success: false, error: "Cannot remove workspace owner from board" };
  }

  // Block removing last admin
  const memberRole = await sql`
    SELECT role FROM project_members
    WHERE project_id = ${projectId} AND agent_id = ${agentId}
  `;
  if (memberRole.rows.length === 0) {
    return { success: false, error: "Agent is not a member of this board" };
  }
  if (memberRole.rows[0].role === "admin") {
    const adminCount = await sql`
      SELECT COUNT(*)::int AS count FROM project_members
      WHERE project_id = ${projectId} AND role = 'admin'
    `;
    if ((adminCount.rows[0].count as number) <= 1) {
      return { success: false, error: "Cannot remove the last admin" };
    }
  }

  // Check for task assignments
  const assignedTasks = await sql`
    SELECT COUNT(*)::int AS count FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE t.project_id = ${projectId} AND ta.agent_id = ${agentId}
  `;
  const assignedCount = assignedTasks.rows[0].count as number;

  if (assignedCount > 0 && !unassignTasks) {
    return { success: false, error: "Agent has task assignments", assignedTaskCount: assignedCount };
  }

  // Unassign from tasks if requested
  if (unassignTasks && assignedCount > 0) {
    await sql`
      DELETE FROM task_assignees
      WHERE agent_id = ${agentId}
        AND task_id IN (SELECT id FROM tasks WHERE project_id = ${projectId})
    `;
  }

  // Remove from board
  await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND agent_id = ${agentId}`;
  return { success: true };
}

export async function getAvailableAgents(projectId: string): Promise<TaskAssignee[]> {
  const result = await sql`
    SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
    FROM agents a
    WHERE a.active = true
      AND a.id NOT IN (SELECT agent_id FROM project_members WHERE project_id = ${projectId})
    ORDER BY a.name ASC
  `;
  return result.rows as unknown as TaskAssignee[];
}

// Also add cross-board tasks for agent
export async function getAgentTasksAcrossBoards(agentId: string, currentProjectId?: string): Promise<(Task & { project_name: string })[]> {
  const result = await sql`
    SELECT t.*, c.name AS column_name, a.name AS creator_name, p.name AS project_name
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN agents a ON a.id = t.creator_id
    WHERE (
      EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${agentId}
      )
      OR (
        NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
        AND (${currentProjectId ?? null}::uuid IS NULL OR t.project_id = ${currentProjectId ?? null}::uuid)
      )
    )
    ORDER BY t.updated_at DESC
  `;

  const tasks = result.rows as (Task & { project_name: string })[];

  // Load assignees and tags per task
  for (const task of tasks) {
    const assignees = await sql`
      SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
      FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id
      WHERE ta.task_id = ${task.id}
    `;
    task.assignees = assignees.rows as unknown as TaskAssignee[];

    const tags = await sql`
      SELECT tt.id, tt.name, tt.color
      FROM task_tag_map ttm JOIN task_tags tt ON tt.id = ttm.tag_id
      WHERE ttm.task_id = ${task.id}
    `;
    task.tags = tags.rows as unknown as TaskTag[];
  }

  return tasks;
}

// ============================================================
// COLUMN QUERIES
// ============================================================

export async function getProjectColumns(projectId: string): Promise<BoardColumn[]> {
  const result = await sql`
    SELECT c.*,
      COUNT(t.id)::int AS task_count
    FROM columns c
    LEFT JOIN tasks t ON t.column_id = c.id
    WHERE c.project_id = ${projectId}
    GROUP BY c.id
    ORDER BY c.position ASC
  `;
  return result.rows as BoardColumn[];
}

export async function createColumn(
  projectId: string,
  name: string,
  color?: string,
  isDone?: boolean
): Promise<BoardColumn> {
  // Get max position
  const maxPos = await sql`
    SELECT COALESCE(MAX(position), 0) AS max_pos FROM columns WHERE project_id = ${projectId}
  `;
  const position = (maxPos.rows[0].max_pos as number) + 1000;

  const result = await sql`
    INSERT INTO columns (project_id, name, position, color, is_done)
    VALUES (${projectId}, ${name}, ${position}, ${color ?? '#6b7280'}, ${isDone ?? false})
    RETURNING *
  `;
  return result.rows[0] as BoardColumn;
}

export async function updateColumn(
  columnId: string,
  fields: { name?: string; color?: string; is_done?: boolean; wip_limit?: number | null }
): Promise<BoardColumn> {
  const result = await sql`
    UPDATE columns SET
      name = COALESCE(${fields.name ?? null}, name),
      color = COALESCE(${fields.color ?? null}, color),
      is_done = COALESCE(${fields.is_done ?? null}, is_done),
      wip_limit = ${fields.wip_limit !== undefined ? fields.wip_limit : null}
    WHERE id = ${columnId}
    RETURNING *
  `;
  return result.rows[0] as BoardColumn;
}

export async function deleteColumn(columnId: string): Promise<{ deleted: boolean; taskCount: number; error?: string }> {
  // Check for tasks
  const taskCheck = await sql`
    SELECT COUNT(*)::int AS count FROM tasks WHERE column_id = ${columnId}
  `;
  const taskCount = taskCheck.rows[0].count as number;
  if (taskCount > 0) {
    return { deleted: false, taskCount };
  }

  // Block deleting the last column
  const col = await sql`SELECT project_id FROM columns WHERE id = ${columnId}`;
  if (col.rows.length > 0) {
    const colCount = await sql`
      SELECT COUNT(*)::int AS count FROM columns WHERE project_id = ${col.rows[0].project_id}
    `;
    if ((colCount.rows[0].count as number) <= 1) {
      return { deleted: false, taskCount: 0, error: "Cannot delete the last column" };
    }
  }

  await sql`DELETE FROM columns WHERE id = ${columnId}`;
  return { deleted: true, taskCount: 0 };
}

export async function reorderColumns(projectId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const position = (i + 1) * 1000;
    await sql`
      UPDATE columns SET position = ${position}
      WHERE id = ${orderedIds[i]} AND project_id = ${projectId}
    `;
  }
}

// ============================================================
// TASK QUERIES
// ============================================================

export async function getProjectTasks(
  projectId: string,
  filters: TaskFilters = {}
): Promise<Task[]> {
  // We'll use parameterized queries via a single query with COALESCE patterns
  // to avoid SQL injection while keeping the query flexible
  const result = await sql`
    SELECT
      t.*,
      c.name AS column_name,
      a.name AS creator_name,
      COALESCE(cl_stats.total, 0)::int AS checklist_total,
      COALESCE(cl_stats.done, 0)::int AS checklist_done,
      COALESCE(cmt_stats.count, 0)::int AS comment_count,
      COALESCE(att_stats.count, 0)::int AS attachment_count,
      last_move.prev_column_name,
      last_move.last_status_at
    FROM tasks t
    LEFT JOIN columns c ON c.id = t.column_id
    LEFT JOIN agents a ON a.id = t.creator_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE is_checked)::int AS done
      FROM checklist_items WHERE task_id = t.id
    ) cl_stats ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count
      FROM comments WHERE task_id = t.id AND deleted_at IS NULL
    ) cmt_stats ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count
      FROM file_attachments WHERE task_id = t.id
    ) att_stats ON true
    LEFT JOIN LATERAL (
      SELECT created_at AS last_status_at, old_value AS prev_column_name
      FROM activity_log
      WHERE task_id = t.id AND action_type = 'task_moved' AND field = 'column'
      ORDER BY created_at DESC
      LIMIT 1
    ) last_move ON true
    WHERE t.project_id = ${projectId}
      AND (${filters.column_id ?? null}::uuid IS NULL OR t.column_id = ${filters.column_id ?? null}::uuid)
      AND (${filters.priority ?? null}::text IS NULL OR t.priority = ${filters.priority ?? null})
      AND (${filters.search ?? null}::text IS NULL OR t.title ILIKE '%' || ${filters.search ?? ''} || '%')
      AND (${filters.due_before ?? null}::timestamptz IS NULL OR t.due_date <= ${filters.due_before ?? null}::timestamptz)
      AND (${filters.due_after ?? null}::timestamptz IS NULL OR t.due_date >= ${filters.due_after ?? null}::timestamptz)
      AND (${filters.assignee_id ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${filters.assignee_id ?? null}::uuid
      ))
      AND (${filters.tag_id ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_tag_map ttm WHERE ttm.task_id = t.id AND ttm.tag_id = ${filters.tag_id ?? null}::uuid
      ))
    ORDER BY
      CASE WHEN ${filters.sort_by ?? 'position'} = 'position' AND ${filters.sort_dir ?? 'asc'} = 'asc' THEN t.position END ASC,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'position' AND ${filters.sort_dir ?? 'asc'} = 'desc' THEN t.position END DESC,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'due_date' AND ${filters.sort_dir ?? 'asc'} = 'asc' THEN t.due_date END ASC NULLS LAST,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'due_date' AND ${filters.sort_dir ?? 'asc'} = 'desc' THEN t.due_date END DESC NULLS LAST,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'priority' AND ${filters.sort_dir ?? 'asc'} = 'asc' THEN
        CASE t.priority WHEN 'urgent' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END
      END ASC,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'priority' AND ${filters.sort_dir ?? 'asc'} = 'desc' THEN
        CASE t.priority WHEN 'urgent' THEN 5 WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END
      END DESC,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'created_at' AND ${filters.sort_dir ?? 'asc'} = 'asc' THEN t.created_at END ASC,
      CASE WHEN ${filters.sort_by ?? 'position'} = 'created_at' AND ${filters.sort_dir ?? 'asc'} = 'desc' THEN t.created_at END DESC,
      t.position ASC
  `;

  const tasks = result.rows as Task[];

  // Batch-load assignees and tags for all tasks
  if (tasks.length > 0) {
    // Load per-task; batch loading with arrays not supported by @vercel/postgres tagged template
    const assigneeMap = new Map<string, TaskAssignee[]>();
    const tagMap = new Map<string, TaskTag[]>();

    for (const task of tasks) {
      const assignees = await sql`
        SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
        FROM task_assignees ta
        JOIN agents a ON a.id = ta.agent_id
        WHERE ta.task_id = ${task.id}
      `;
      assigneeMap.set(task.id, assignees.rows as unknown as TaskAssignee[]);

      const taskTags = await sql`
        SELECT tt.id, tt.name, tt.color
        FROM task_tag_map ttm
        JOIN task_tags tt ON tt.id = ttm.tag_id
        WHERE ttm.task_id = ${task.id}
      `;
      tagMap.set(task.id, taskTags.rows as unknown as TaskTag[]);
    }

    for (const task of tasks) {
      task.assignees = assigneeMap.get(task.id) ?? [];
      task.tags = tagMap.get(task.id) ?? [];
    }
  }

  return tasks;
}

export async function getTaskProjectId(taskId: string): Promise<string | null> {
  const result = await sql`SELECT project_id FROM tasks WHERE id = ${taskId} LIMIT 1`;
  return result.rows[0]?.project_id ?? null;
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const result = await sql`
    SELECT t.*,
      c.name AS column_name,
      a.name AS creator_name
    FROM tasks t
    LEFT JOIN columns c ON c.id = t.column_id
    LEFT JOIN agents a ON a.id = t.creator_id
    WHERE t.id = ${taskId}
  `;
  if (result.rows.length === 0) return null;

  const task = result.rows[0] as Task;

  // Load assignees
  const assignees = await sql`
    SELECT a.id AS agent_id, a.name, a.email, a.avatar_url
    FROM task_assignees ta
    JOIN agents a ON a.id = ta.agent_id
    WHERE ta.task_id = ${taskId}
  `;
  task.assignees = assignees.rows as unknown as TaskAssignee[];

  // Load tags
  const tags = await sql`
    SELECT tt.id, tt.name, tt.color
    FROM task_tag_map ttm
    JOIN task_tags tt ON tt.id = ttm.tag_id
    WHERE ttm.task_id = ${taskId}
  `;
  task.tags = tags.rows as unknown as TaskTag[];

  // Load checklist items + stats
  const checklistRows = await sql`
    SELECT * FROM checklist_items WHERE task_id = ${taskId} ORDER BY position ASC
  `;
  task.checklist_items = checklistRows.rows as ChecklistItem[];
  task.checklist_total = checklistRows.rows.length;
  task.checklist_done = checklistRows.rows.filter((r) => r.is_checked).length;

  // Load comment count
  const comments = await sql`
    SELECT COUNT(*)::int AS count FROM comments WHERE task_id = ${taskId} AND deleted_at IS NULL
  `;
  task.comment_count = comments.rows[0].count as number;

  // Load attachment count
  const attachments = await sql`
    SELECT COUNT(*)::int AS count FROM file_attachments WHERE task_id = ${taskId}
  `;
  task.attachment_count = attachments.rows[0].count as number;

  return task;
}

// ============================================================
// TASK MUTATIONS
// ============================================================

export async function createTask(data: {
  project_id: string;
  column_id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  creator_id?: string | null;
  assignee_ids?: string[];
  tag_ids?: string[];
  custom_fields?: Record<string, unknown>;
}): Promise<Task> {
  // Get next position in column
  const maxPos = await sql`
    SELECT COALESCE(MAX(position), 0) AS max_pos FROM tasks WHERE column_id = ${data.column_id}
  `;
  const position = (maxPos.rows[0].max_pos as number) + 1000;

  const result = await sql`
    INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, start_date, position, creator_id, custom_fields)
    VALUES (
      ${data.project_id},
      ${data.column_id},
      ${data.title},
      ${data.description ?? null},
      ${data.priority ?? null},
      ${data.due_date ?? null},
      ${data.start_date ?? null},
      ${position},
      ${data.creator_id ?? null},
      ${JSON.stringify(data.custom_fields ?? {})}
    )
    RETURNING *
  `;
  const task = result.rows[0] as Task;

  // Add assignees
  if (data.assignee_ids && data.assignee_ids.length > 0) {
    for (const agentId of data.assignee_ids) {
      await sql`
        INSERT INTO task_assignees (task_id, agent_id)
        VALUES (${task.id}, ${agentId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // Add tags
  if (data.tag_ids && data.tag_ids.length > 0) {
    for (const tagId of data.tag_ids) {
      await sql`
        INSERT INTO task_tag_map (task_id, tag_id)
        VALUES (${task.id}, ${tagId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // Log activity
  await logActivity(task.id, data.creator_id ?? null, "task_created", null, null, data.title);

  return task;
}

export async function updateTask(
  taskId: string,
  fields: {
    title?: string;
    description?: string | null;
    priority?: string | null;
    due_date?: string | null;
    start_date?: string | null;
    custom_fields?: Record<string, unknown>;
  },
  actorId?: string | null
): Promise<Task | null> {
  // Get current values for activity logging
  const current = await sql`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (current.rows.length === 0) return null;
  const old = current.rows[0];

  const result = await sql`
    UPDATE tasks SET
      title = COALESCE(${fields.title ?? null}, title),
      description = ${fields.description !== undefined ? (fields.description ?? null) : old.description},
      priority = ${fields.priority !== undefined ? (fields.priority ?? null) : old.priority},
      due_date = ${fields.due_date !== undefined ? (fields.due_date ?? null) : old.due_date},
      start_date = ${fields.start_date !== undefined ? (fields.start_date ?? null) : old.start_date},
      custom_fields = ${fields.custom_fields !== undefined ? JSON.stringify(fields.custom_fields) : JSON.stringify(old.custom_fields)}
    WHERE id = ${taskId}
    RETURNING *
  `;
  if (result.rows.length === 0) return null;

  // Log field changes
  if (fields.title !== undefined && fields.title !== old.title) {
    await logActivity(taskId, actorId ?? null, "field_changed", "title", old.title, fields.title);
  }
  if (fields.priority !== undefined && fields.priority !== old.priority) {
    await logActivity(taskId, actorId ?? null, "field_changed", "priority", old.priority, fields.priority);
  }
  if (fields.due_date !== undefined && fields.due_date !== old.due_date) {
    await logActivity(taskId, actorId ?? null, "field_changed", "due_date", old.due_date, fields.due_date);
  }
  if (fields.description !== undefined && fields.description !== old.description) {
    await logActivity(taskId, actorId ?? null, "field_changed", "description", null, null);
  }

  return result.rows[0] as Task;
}

export async function moveTask(
  taskId: string,
  columnId: string,
  position?: number,
  actorId?: string | null
): Promise<Task | null> {
  const current = await sql`
    SELECT t.column_id, t.position, c.name AS column_name
    FROM tasks t JOIN columns c ON c.id = t.column_id
    WHERE t.id = ${taskId}
  `;
  if (current.rows.length === 0) return null;
  const old = current.rows[0];

  // If no position specified, append to end
  let newPosition = position;
  if (newPosition === undefined) {
    const maxPos = await sql`
      SELECT COALESCE(MAX(position), 0) AS max_pos FROM tasks WHERE column_id = ${columnId}
    `;
    newPosition = (maxPos.rows[0].max_pos as number) + 1000;
  }

  const result = await sql`
    UPDATE tasks SET column_id = ${columnId}, position = ${newPosition}
    WHERE id = ${taskId}
    RETURNING *
  `;
  if (result.rows.length === 0) return null;

  // Log column change if it changed
  if (old.column_id !== columnId) {
    const newCol = await sql`SELECT name FROM columns WHERE id = ${columnId}`;
    const newColName = newCol.rows[0]?.name ?? columnId;
    await logActivity(
      taskId, actorId ?? null, "task_moved", "column",
      old.column_name as string, newColName as string
    );
  }

  return result.rows[0] as Task;
}

export async function deleteTask(taskId: string, _actorId?: string | null): Promise<boolean> {
  const task = await sql`SELECT title FROM tasks WHERE id = ${taskId}`;
  if (task.rows.length === 0) return false;

  // Delete activity_log entries first — trigger may block DELETE if migration 007 not applied
  try {
    await sql`DELETE FROM activity_log WHERE task_id = ${taskId}`;
  } catch {
    // Trigger blocks DELETE — apply migration 007 fix inline, then retry
    await fixActivityLogTrigger();
    await sql`DELETE FROM activity_log WHERE task_id = ${taskId}`;
  }
  // CASCADE handles assignees, tags, comments, checklist, attachments
  await sql`DELETE FROM tasks WHERE id = ${taskId}`;
  return true;
}

// ============================================================
// TASK ASSIGNEES
// ============================================================

export async function setTaskAssignees(
  taskId: string,
  agentIds: string[],
  actorId?: string | null
): Promise<void> {
  // Get current assignees for logging
  const current = await sql`
    SELECT a.name FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id WHERE ta.task_id = ${taskId}
  `;
  const oldNames = current.rows.map((r) => r.name as string).join(", ");

  // Clear and re-add
  await sql`DELETE FROM task_assignees WHERE task_id = ${taskId}`;
  for (const agentId of agentIds) {
    await sql`
      INSERT INTO task_assignees (task_id, agent_id)
      VALUES (${taskId}, ${agentId})
      ON CONFLICT DO NOTHING
    `;
  }

  // Get new names for logging
  if (agentIds.length > 0) {
    const newNames: string[] = [];
    for (const agentId of agentIds) {
      const a = await sql`SELECT name FROM agents WHERE id = ${agentId}`;
      if (a.rows.length > 0) newNames.push(a.rows[0].name as string);
    }
    await logActivity(taskId, actorId ?? null, "field_changed", "assignees", oldNames, newNames.join(", "));
  } else {
    await logActivity(taskId, actorId ?? null, "field_changed", "assignees", oldNames, "");
  }
}

// ============================================================
// ACTIVITY LOG
// ============================================================

export async function logActivity(
  taskId: string,
  actorId: string | null,
  actionType: string,
  field?: string | null,
  oldValue?: string | null,
  newValue?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  // Look up actor name for the label
  let actorLabel = "System";
  if (actorId) {
    const actor = await sql`SELECT name FROM agents WHERE id = ${actorId}`;
    if (actor.rows.length > 0) actorLabel = actor.rows[0].name as string;
  }

  await sql`
    INSERT INTO activity_log (task_id, actor_id, actor_label, action_type, field, old_value, new_value, metadata)
    VALUES (
      ${taskId},
      ${actorId},
      ${actorLabel},
      ${actionType},
      ${field ?? null},
      ${oldValue ?? null},
      ${newValue ?? null},
      ${JSON.stringify(metadata ?? {})}
    )
  `;
}

export async function getTaskActivity(
  taskId: string,
  commentsOnly: boolean = false
): Promise<ActivityLogEntry[]> {
  if (commentsOnly) {
    const result = await sql`
      SELECT al.*, a.name AS actor_name, a.avatar_url AS actor_avatar
      FROM activity_log al
      LEFT JOIN agents a ON a.id = al.actor_id
      WHERE al.task_id = ${taskId} AND al.action_type = 'comment_added'
      ORDER BY al.created_at DESC
    `;
    return result.rows as ActivityLogEntry[];
  }

  const result = await sql`
    SELECT al.*, a.name AS actor_name, a.avatar_url AS actor_avatar
    FROM activity_log al
    LEFT JOIN agents a ON a.id = al.actor_id
    WHERE al.task_id = ${taskId}
    ORDER BY al.created_at DESC
  `;
  return result.rows as ActivityLogEntry[];
}

// ============================================================
// COMMENTS
// ============================================================

export async function getTaskComments(taskId: string): Promise<Comment[]> {
  const result = await sql`
    SELECT c.*, a.name AS author_name, a.avatar_url AS author_avatar,
      (SELECT COUNT(*)::int FROM comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL) AS reply_count
    FROM comments c
    JOIN agents a ON a.id = c.author_id
    WHERE c.task_id = ${taskId} AND c.parent_id IS NULL
    ORDER BY c.created_at ASC
  `;
  return result.rows as Comment[];
}

export async function getCommentReplies(commentId: string): Promise<Comment[]> {
  const result = await sql`
    SELECT c.*, a.name AS author_name, a.avatar_url AS author_avatar
    FROM comments c
    JOIN agents a ON a.id = c.author_id
    WHERE c.parent_id = ${commentId} AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC
  `;
  return result.rows as Comment[];
}

export async function createComment(
  taskId: string,
  authorId: string,
  body: string,
  parentId?: string | null
): Promise<Comment> {
  const result = await sql`
    INSERT INTO comments (task_id, author_id, parent_id, body)
    VALUES (${taskId}, ${authorId}, ${parentId ?? null}, ${body})
    RETURNING *
  `;

  // Get author info
  const author = await sql`SELECT name, avatar_url FROM agents WHERE id = ${authorId}`;
  const comment = result.rows[0] as Comment;
  comment.author_name = (author.rows[0]?.name as string) ?? "Unknown";
  comment.author_avatar = (author.rows[0]?.avatar_url as string | null) ?? null;

  await logActivity(taskId, authorId, "comment_added");

  return comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  await sql`
    UPDATE comments SET deleted_at = NOW(), body = '[deleted]'
    WHERE id = ${commentId}
  `;
}

// ============================================================
// CHECKLIST
// ============================================================

export async function getChecklistItems(taskId: string): Promise<ChecklistItem[]> {
  const result = await sql`
    SELECT * FROM checklist_items
    WHERE task_id = ${taskId}
    ORDER BY position ASC
  `;
  return result.rows as ChecklistItem[];
}

export async function createChecklistItem(
  taskId: string,
  title: string
): Promise<ChecklistItem> {
  const maxPos = await sql`
    SELECT COALESCE(MAX(position), 0) AS max_pos FROM checklist_items WHERE task_id = ${taskId}
  `;
  const position = (maxPos.rows[0].max_pos as number) + 1000;

  const result = await sql`
    INSERT INTO checklist_items (task_id, title, position)
    VALUES (${taskId}, ${title}, ${position})
    RETURNING *
  `;
  return result.rows[0] as ChecklistItem;
}

export async function toggleChecklistItem(
  itemId: string,
  isChecked: boolean
): Promise<ChecklistItem> {
  const result = await sql`
    UPDATE checklist_items SET is_checked = ${isChecked}
    WHERE id = ${itemId}
    RETURNING *
  `;
  return result.rows[0] as ChecklistItem;
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  await sql`DELETE FROM checklist_items WHERE id = ${itemId}`;
}

// ============================================================
// TAGS
// ============================================================

export async function getProjectTags(projectId: string): Promise<TaskTag[]> {
  const result = await sql`
    SELECT * FROM task_tags WHERE project_id = ${projectId} ORDER BY name ASC
  `;
  return result.rows as TaskTag[];
}

export async function createTag(projectId: string, name: string, color?: string): Promise<TaskTag> {
  const result = await sql`
    INSERT INTO task_tags (project_id, name, color)
    VALUES (${projectId}, ${name}, ${color ?? '#6b7280'})
    RETURNING *
  `;
  return result.rows[0] as TaskTag;
}

export async function setTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  await sql`DELETE FROM task_tag_map WHERE task_id = ${taskId}`;
  for (const tagId of tagIds) {
    await sql`
      INSERT INTO task_tag_map (task_id, tag_id)
      VALUES (${taskId}, ${tagId})
      ON CONFLICT DO NOTHING
    `;
  }
}

// ============================================================
// CUSTOM FIELD DEFINITIONS
// ============================================================

export async function getCustomFieldDefinitions(projectId: string, includeArchived = false): Promise<CustomFieldDefinition[]> {
  const result = includeArchived
    ? await sql`SELECT * FROM custom_field_definitions WHERE project_id = ${projectId} ORDER BY position ASC, created_at ASC`
    : await sql`SELECT * FROM custom_field_definitions WHERE project_id = ${projectId} AND archived = false ORDER BY position ASC, created_at ASC`;
  return result.rows as CustomFieldDefinition[];
}

export async function createCustomFieldDefinition(projectId: string, data: {
  name: string;
  field_type: CustomFieldDefinition["field_type"];
  options?: string[] | null;
  required?: boolean;
  show_on_card?: boolean;
}): Promise<CustomFieldDefinition> {
  const posResult = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM custom_field_definitions WHERE project_id = ${projectId}`;
  const nextPos = posResult.rows[0].next_pos as number;
  const result = await sql`
    INSERT INTO custom_field_definitions (project_id, name, field_type, options, required, position, show_on_card)
    VALUES (${projectId}, ${data.name}, ${data.field_type}, ${data.options ? JSON.stringify(data.options) : null}, ${data.required ?? false}, ${nextPos}, ${data.show_on_card ?? false})
    RETURNING *`;
  return result.rows[0] as CustomFieldDefinition;
}

export async function updateCustomFieldDefinition(fieldId: string, fields: {
  name?: string;
  options?: string[] | null;
  required?: boolean;
  show_on_card?: boolean;
}): Promise<CustomFieldDefinition | null> {
  const result = await sql`
    UPDATE custom_field_definitions SET
      name = COALESCE(${fields.name ?? null}, name),
      options = COALESCE(${fields.options !== undefined ? JSON.stringify(fields.options) : null}, options),
      required = COALESCE(${fields.required ?? null}, required),
      show_on_card = COALESCE(${fields.show_on_card ?? null}, show_on_card)
    WHERE id = ${fieldId} AND archived = false
    RETURNING *`;
  return (result.rows[0] as CustomFieldDefinition) ?? null;
}

export async function archiveCustomFieldDefinition(fieldId: string): Promise<boolean> {
  const result = await sql`UPDATE custom_field_definitions SET archived = true WHERE id = ${fieldId} RETURNING id`;
  return result.rows.length > 0;
}

export async function restoreCustomFieldDefinition(fieldId: string): Promise<boolean> {
  const result = await sql`UPDATE custom_field_definitions SET archived = false WHERE id = ${fieldId} RETURNING id`;
  return result.rows.length > 0;
}

export async function reorderCustomFieldDefinitions(projectId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql`UPDATE custom_field_definitions SET position = ${i + 1} WHERE id = ${orderedIds[i]} AND project_id = ${projectId}`;
  }
}

// ============================================================
// SAVED VIEWS
// ============================================================

export async function getSavedViews(projectId: string): Promise<SavedView[]> {
  const result = await sql`
    SELECT sv.*, a.name AS owner_name FROM saved_views sv
    LEFT JOIN agents a ON a.id = sv.owner_id
    WHERE sv.project_id = ${projectId} ORDER BY sv.created_at ASC`;
  return result.rows as SavedView[];
}

export async function createSavedView(data: {
  project_id: string;
  owner_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
}): Promise<SavedView> {
  const result = await sql`
    INSERT INTO saved_views (project_id, owner_id, name, filters, sort)
    VALUES (${data.project_id}, ${data.owner_id}, ${data.name}, ${JSON.stringify(data.filters)}, ${JSON.stringify(data.sort)})
    RETURNING *`;
  return result.rows[0] as SavedView;
}

export async function deleteSavedView(viewId: string): Promise<boolean> {
  const result = await sql`DELETE FROM saved_views WHERE id = ${viewId} RETURNING id`;
  return result.rows.length > 0;
}

// ============================================================
// JOB-TASK STATUS SYNC
// ============================================================

/**
 * Get the linked job_id from a task's custom_fields._job_id.
 * Returns null if no linked job.
 */
export async function getLinkedJobId(taskId: string): Promise<string | null> {
  const result = await sql`
    SELECT custom_fields->>'_job_id' AS job_id
    FROM tasks WHERE id = ${taskId}
  `;
  return result.rows[0]?.job_id ?? null;
}

/**
 * Sync job status when a task moves columns on the board.
 * - Updates jobs.status to the new column name
 * - Sets outcome to 'won'/'lost' when moving to terminal columns
 * - Clears outcome when moving OUT of terminal columns (reversal)
 * - Sets proposal_sent_at when entering post-sent columns
 */
export async function syncJobStatusFromTask(
  taskId: string,
  newColumnName: string,
  oldColumnName?: string
): Promise<boolean> {
  // Find linked job via custom_fields._job_id or jobs.task_id
  const result = await sql`
    SELECT j.id, j.job_id, j.outcome
    FROM jobs j
    WHERE j.task_id = ${taskId}
       OR j.job_id = (SELECT custom_fields->>'_job_id' FROM tasks WHERE id = ${taskId})
    LIMIT 1
  `;
  if (result.rows.length === 0) return false;

  const job = result.rows[0];
  const lowerCol = newColumnName.toLowerCase();
  const lowerOld = oldColumnName?.toLowerCase();

  // Terminal columns
  const isWon = lowerCol === 'won';
  const isLost = lowerCol === 'lost';
  const wasTerminal = lowerOld === 'won' || lowerOld === 'lost';

  // Post-sent columns (proposal has been sent) — includes actual board column names + legacy names
  const postSentStatuses = [
    'proposal submitted', 'sent', 'submitted', 'following up',
    'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
    'in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost'
  ];
  const isPostSent = postSentStatuses.includes(lowerCol);

  // Meeting milestone columns — meeting_booked_at covers any entry to a meeting column
  const meetingStatuses = ['meeting scheduled', 'meeting done'];
  const isMeeting = meetingStatuses.includes(lowerCol);

  // Additional historical-reach milestones (migration 014)
  const isProposalViewed = ['proposal views', 'proposal viewed', 'viewed'].includes(lowerCol);
  const isInChat = ['in chat', 'following up'].includes(lowerCol);
  const isMeetingDone = lowerCol === 'meeting done';

  if (isWon) {
    await sql`
      UPDATE jobs SET status = ${newColumnName}, outcome = 'won', outcome_at = NOW(), stage_entered_at = NOW(), updated_at = NOW()
      WHERE id = ${job.id}
    `;
  } else if (isLost) {
    await sql`
      UPDATE jobs SET status = ${newColumnName}, outcome = 'lost', outcome_at = NOW(), stage_entered_at = NOW(), updated_at = NOW()
      WHERE id = ${job.id}
    `;
  } else if (wasTerminal) {
    // Reversal: moving out of Won/Lost → clear outcome
    await sql`
      UPDATE jobs SET status = ${newColumnName}, outcome = NULL, outcome_at = NULL, stage_entered_at = NOW(), updated_at = NOW()
      WHERE id = ${job.id}
    `;
  } else {
    await sql`
      UPDATE jobs SET status = ${newColumnName}, stage_entered_at = NOW(), updated_at = NOW()
      WHERE id = ${job.id}
    `;
  }

  // Set proposal_sent_at when first entering a post-sent column
  if (isPostSent) {
    await sql`
      UPDATE jobs SET proposal_sent_at = COALESCE(proposal_sent_at, NOW())
      WHERE id = ${job.id} AND proposal_sent_at IS NULL
    `;
  }

  // Set meeting_booked_at when first entering a meeting column (lifecycle milestone)
  if (isMeeting) {
    await sql`
      UPDATE jobs SET meeting_booked_at = COALESCE(meeting_booked_at, NOW())
      WHERE id = ${job.id} AND meeting_booked_at IS NULL
    `;
  }

  // Migration-014 milestones: first-reach only, preserved across reversals/Lost
  if (isProposalViewed) {
    await sql`
      UPDATE jobs SET proposal_viewed_at = COALESCE(proposal_viewed_at, NOW())
      WHERE id = ${job.id} AND proposal_viewed_at IS NULL
    `;
  }
  if (isInChat) {
    await sql`
      UPDATE jobs SET in_chat_at = COALESCE(in_chat_at, NOW())
      WHERE id = ${job.id} AND in_chat_at IS NULL
    `;
  }
  if (isMeetingDone) {
    await sql`
      UPDATE jobs SET meeting_done_at = COALESCE(meeting_done_at, NOW())
      WHERE id = ${job.id} AND meeting_done_at IS NULL
    `;
  }

  return true;
}

/**
 * Bulk-update job statuses when a column is renamed.
 * All tasks in the column with linked jobs get their job.status updated.
 */
export async function syncAllJobsInColumn(columnId: string, newColumnName: string): Promise<number> {
  const result = await sql`
    UPDATE jobs SET status = ${newColumnName}, updated_at = NOW()
    WHERE job_id IN (
      SELECT custom_fields->>'_job_id'
      FROM tasks
      WHERE column_id = ${columnId}
        AND custom_fields->>'_job_id' IS NOT NULL
    )
    OR task_id IN (
      SELECT id FROM tasks WHERE column_id = ${columnId}
    )
  `;
  return result.rowCount ?? 0;
}
