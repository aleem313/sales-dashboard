"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Task Board error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4 max-w-md mx-auto px-4">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          The task board encountered an error. This is usually temporary.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
