// ClickUp API client for task sync

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_BASE_URL = "https://api.clickup.com/api/v2";

export function isClickUpConfigured(): boolean {
  return Boolean(CLICKUP_API_KEY);
}

export async function fetchTask(
  taskId: string
): Promise<{ id: string; status: { status: string }; name: string; space?: { id: string } } | null> {
  if (!CLICKUP_API_KEY) return null;

  const res = await fetch(`${CLICKUP_BASE_URL}/task/${taskId}`, {
    headers: { Authorization: CLICKUP_API_KEY },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`ClickUp API error: ${res.status}`);
  }

  return res.json();
}

export async function fetchTasks(
  listId: string,
  page: number = 0
): Promise<{ tasks: { id: string; status: { status: string }; name: string }[] }> {
  if (!CLICKUP_API_KEY) return { tasks: [] };

  const res = await fetch(
    `${CLICKUP_BASE_URL}/list/${listId}/task?page=${page}&include_closed=true`,
    {
      headers: { Authorization: CLICKUP_API_KEY },
      next: { revalidate: 0 },
    }
  );

  if (!res.ok) throw new Error(`ClickUp API error: ${res.status}`);
  return res.json();
}

export async function updateTaskStatus(
  taskId: string,
  status: string
): Promise<void> {
  if (!CLICKUP_API_KEY) return;

  const res = await fetch(`${CLICKUP_BASE_URL}/task/${taskId}`, {
    method: "PUT",
    headers: {
      Authorization: CLICKUP_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    throw new Error(`ClickUp API error updating task status: ${res.status}`);
  }
}

export function mapStatusToOutcome(
  status: string
): "won" | "lost" | null {
  const lower = status.toLowerCase();
  if (lower === "won" || lower === "closed won") return "won";
  if (lower === "lost" || lower === "closed lost") return "lost";
  return null;
}

// Rising Lion space ID — only process tasks from this space
export const RISING_LION_SPACE_ID = process.env.CLICKUP_SPACE_ID ?? "90189402960";

// Check if a task belongs to the Rising Lion space
export async function isRisingLionTask(taskId: string): Promise<boolean> {
  if (!CLICKUP_API_KEY) return false;

  const res = await fetch(`${CLICKUP_BASE_URL}/task/${taskId}`, {
    headers: { Authorization: CLICKUP_API_KEY },
    next: { revalidate: 0 },
  });

  if (!res.ok) return false;

  const task = await res.json();
  return task.space?.id === RISING_LION_SPACE_ID;
}
