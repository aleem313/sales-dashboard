"use client";

import type { KPIMetricTaskRow } from "@/lib/data";

// Shared presentation for a list of KPI metric tasks (used by both the single
// KPIMetricDrillDown modal and the System/Manual tabbed drill-down). Pure: no
// data fetching, just renders rows that deep-link to the task board.
export function MetricTaskList({
  tasks,
  taskRoute,
  emptyMessage,
}: {
  tasks: KPIMetricTaskRow[];
  taskRoute: "/tasks" | "/my-tasks";
  emptyMessage: string;
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.id}>
          <a
            href={`${taskRoute}?task=${t.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md px-2 py-2.5 -mx-2 hover:bg-secondary/50 transition"
          >
            <div className="text-sm font-medium text-foreground line-clamp-2">
              {t.title}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t.columnName}</span>
              <span>·</span>
              <span className="truncate">
                {t.assignees ?? <span className="italic">Unassigned</span>}
              </span>
              {t.firstAt && (
                <>
                  <span>·</span>
                  <span>{new Date(t.firstAt).toLocaleString()}</span>
                </>
              )}
            </div>
            {t.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {t.tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
                    style={{
                      backgroundColor: `${tag.color ?? "#6b7280"}22`,
                      color: tag.color ?? "#6b7280",
                      border: `1px solid ${tag.color ?? "#6b7280"}55`,
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
