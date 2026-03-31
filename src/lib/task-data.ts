import { sql } from "@vercel/postgres";

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
  checklist_total?: number;
  checklist_done?: number;
  comment_count?: number;
  attachment_count?: number;
  column_name?: string;
  creator_name?: string | null;
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
  return result.rows[0] as Project | null ?? null;
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

export async function deleteColumn(columnId: string): Promise<{ deleted: boolean; taskCount: number }> {
  // Check for tasks
  const taskCheck = await sql`
    SELECT COUNT(*)::int AS count FROM tasks WHERE column_id = ${columnId}
  `;
  const taskCount = taskCheck.rows[0].count as number;
  if (taskCount > 0) {
    return { deleted: false, taskCount };
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
  // Build WHERE clauses
  const conditions: string[] = [`t.project_id = '${projectId}'`];

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
      COALESCE(att_stats.count, 0)::int AS attachment_count
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

  // Load checklist stats
  const checklist = await sql`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_checked)::int AS done
    FROM checklist_items WHERE task_id = ${taskId}
  `;
  task.checklist_total = checklist.rows[0].total as number;
  task.checklist_done = checklist.rows[0].done as number;

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

export async function deleteTask(taskId: string, actorId?: string | null): Promise<boolean> {
  const task = await sql`SELECT title FROM tasks WHERE id = ${taskId}`;
  if (task.rows.length === 0) return false;

  // Activity log will be cascade-deleted, but we could log to a separate audit table if needed
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
