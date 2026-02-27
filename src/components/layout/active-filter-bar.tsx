"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

interface ActiveFilterBarProps {
  agents: Agent[];
  profiles: Profile[];
}

const rangeLabels: Record<string, string> = {
  "7": "This Week",
  "30": "This Month",
  all: "All Time",
};

function ActiveFilterBarInner({ agents, profiles }: ActiveFilterBarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const agentId = searchParams.get("agent");
  const profileId = searchParams.get("profile");
  const range = searchParams.get("range");

  const agentName = agentId
    ? agents.find((a) => a.id === agentId)?.name ?? agentId
    : null;
  const profileName = profileId
    ? profiles.find((p) => p.id === profileId)?.profile_name ?? profileId
    : null;
  const rangeLabel = range ? rangeLabels[range] ?? range : null;

  const hasFilters = agentName || profileName || rangeLabel;
  if (!hasFilters) return null;

  function removeParam(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearAll() {
    router.push(pathname);
  }

  const chips: { key: string; label: string; paramKey: string }[] = [];
  if (agentName) chips.push({ key: "agent", label: `Agent: ${agentName}`, paramKey: "agent" });
  if (profileName) chips.push({ key: "profile", label: `Profile: ${profileName}`, paramKey: "profile" });
  if (rangeLabel) chips.push({ key: "range", label: rangeLabel, paramKey: "range" });

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 md:px-7">
      <span className="text-[11px] text-muted-foreground">Filters:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={() => removeParam(chip.paramKey)}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-light)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white"
        >
          {chip.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          onClick={clearAll}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export function ActiveFilterBar(props: ActiveFilterBarProps) {
  return (
    <Suspense fallback={null}>
      <ActiveFilterBarInner {...props} />
    </Suspense>
  );
}
