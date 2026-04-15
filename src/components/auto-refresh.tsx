"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({
  interval = 15000,
  runInBackground = false,
}: {
  interval?: number;
  runInBackground?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (runInBackground || !document.hidden) {
        router.refresh();
      }
    }, interval);

    return () => clearInterval(id);
  }, [interval, runInBackground, router]);

  return null;
}
