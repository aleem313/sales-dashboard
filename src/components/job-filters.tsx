"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

const STATUSES = ["Proposal Ready", "Sent", "Following Up", "Won", "Lost"];
const OUTCOMES = ["won", "lost", "pending", "skipped"];

export function JobFilters({
  agents,
  profiles,
}: {
  agents: Agent[];
  profiles: Profile[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page"); // reset pagination on filter change
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const clearAll = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const hasFilters =
    searchParams.has("agent") ||
    searchParams.has("profile") ||
    searchParams.has("status") ||
    searchParams.has("outcome") ||
    searchParams.has("budget_type") ||
    searchParams.has("search");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs..."
            defaultValue={searchParams.get("search") ?? ""}
            className="h-9 rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring w-48"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateParam("search", (e.target as HTMLInputElement).value || null);
              }
            }}
          />
        </div>

        {/* Agent */}
        <Select
          value={searchParams.get("agent") ?? "all"}
          onValueChange={(v) => updateParam("agent", v)}
        >
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Profile */}
        <Select
          value={searchParams.get("profile") ?? "all"}
          onValueChange={(v) => updateParam("profile", v)}
        >
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="All profiles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All profiles</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.profile_id} value={p.profile_id}>
                {p.profile_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status */}
        <Select
          value={searchParams.get("status") ?? "all"}
          onValueChange={(v) => updateParam("status", v)}
        >
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Outcome */}
        <Select
          value={searchParams.get("outcome") ?? "all"}
          onValueChange={(v) => updateParam("outcome", v)}
        >
          <SelectTrigger className="w-[130px] h-9">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Budget type */}
        <Select
          value={searchParams.get("budget_type") ?? "all"}
          onValueChange={(v) => updateParam("budget_type", v)}
        >
          <SelectTrigger className="w-[120px] h-9">
            <SelectValue placeholder="All budgets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All budgets</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="hourly">Hourly</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
