"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { playBeep } from "@/lib/notification-sound";

type TaskLike = { id: string; title: string };

export function useNewTaskNotifier(tasks: TaskLike[], opts?: { enabled?: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    if (seen.current === null) {
      seen.current = new Set(tasks.map((t) => t.id));
      return;
    }

    const currentIds = new Set(tasks.map((t) => t.id));
    const newOnes = tasks.filter((t) => !seen.current!.has(t.id));

    for (const t of newOnes) {
      toast.success("New task", { description: t.title });
      playBeep();

      if (
        typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        window.isSecureContext &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("New task", { body: t.title, tag: t.id });
        } catch {
          // HTTP context or other issue — silent
        }
      }

      seen.current!.add(t.id);
    }

    for (const id of Array.from(seen.current)) {
      if (!currentIds.has(id)) seen.current.delete(id);
    }
  }, [tasks, enabled]);
}
