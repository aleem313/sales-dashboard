import { toast } from "sonner";
import { playBeep } from "@/lib/notification-sound";

/**
 * Shared, process-wide (per browser tab) dedup of task ids we've already
 * announced. Two code paths can surface a new task — the real-time SSE stream
 * and the polling `useNewTaskNotifier` — and they must never double-beep the
 * same card. `notifyNewTask` is idempotent per id; whichever path sees the task
 * first wins, the other no-ops.
 */
const notified = new Set<string>();

/**
 * Beep + toast + (if permitted) OS notification for a newly-created task.
 * Idempotent: a second call with the same id does nothing.
 */
export function notifyNewTask(task: { id: string; title: string }): void {
  if (notified.has(task.id)) return;
  notified.add(task.id);

  // Keep the set from growing unbounded over a long-lived session; drop the
  // oldest ~100 ids once it gets large (Set preserves insertion order).
  if (notified.size > 500) {
    let dropped = 0;
    for (const id of notified) {
      notified.delete(id);
      if (++dropped >= 100) break;
    }
  }

  toast.success("New task", { description: task.title });
  playBeep();

  if (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    window.isSecureContext &&
    Notification.permission === "granted"
  ) {
    try {
      new Notification("New task", { body: task.title, tag: task.id });
    } catch {
      // HTTP context or other issue — silent
    }
  }
}

/** Mark a task id as already announced without beeping (used when seeding). */
export function markNotified(id: string): void {
  notified.add(id);
}
