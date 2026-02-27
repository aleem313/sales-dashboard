"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { presetLabels } from "@/components/date-range-picker";
import type { Agent, Profile } from "@/lib/types";

interface ActiveFilterBarProps {
  agents: Agent[];
  profiles: Profile[];
}

export function ActiveFilterBar({ agents, profiles }: ActiveFilterBarProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agent");
  const profileId = params.get("profile");
  const range = params.get("range");
  const from = params.get("from");
  const to = params.get("to");

  const agentName = agentId
    ? agents.find((a) => a.id === agentId)?.name ?? agentId
    : null;
  const profileName = profileId
    ? profiles.find((p) => p.profile_id === profileId)?.profile_name ?? profileId
    : null;

  let rangeLabel: string | null = null;
  if (from && to) {
    rangeLabel = `${from} to ${to}`;
  } else if (range && range in presetLabels) {
    rangeLabel = presetLabels[range];
  }

  const hasFilters = agentName || profileName || rangeLabel;
  if (!hasFilters) return null;

  function removeParam(key: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    window.location.assign(url.toString());
  }

  function removeDateFilter() {
    const url = new URL(window.location.href);
    url.searchParams.delete("range");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    window.location.assign(url.toString());
  }

  function clearAll() {
    window.location.assign(window.location.pathname);
  }

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (agentName) chips.push({ key: "agent", label: `Agent: ${agentName}`, onRemove: () => removeParam("agent") });
  if (profileName) chips.push({ key: "profile", label: `Profile: ${profileName}`, onRemove: () => removeParam("profile") });
  if (rangeLabel) chips.push({ key: "range", label: rangeLabel, onRemove: removeDateFilter });

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2 md:px-7">
      <span className="text-[13.5px] text-muted-foreground">Filters:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={chip.onRemove}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-light)] px-2.5 py-1 text-[13.5px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white"
        >
          {chip.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          onClick={clearAll}
          className="text-[13.5px] text-muted-foreground underline hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
