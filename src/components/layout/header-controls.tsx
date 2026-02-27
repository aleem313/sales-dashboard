"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Download, LogOut } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

interface HeaderControlsProps {
  agents: Agent[];
  profiles: Profile[];
  user?: { name?: string | null; image?: string | null } | null;
  signOutAction?: () => Promise<void>;
}

const dateRanges = [
  { label: "This Week", value: "7" },
  { label: "This Month", value: "30" },
  { label: "All Time", value: "all" },
];

export function HeaderControls({
  agents,
  profiles,
  user,
  signOutAction,
}: HeaderControlsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentRange = searchParams.get("range") ?? "7";
  const currentAgent = searchParams.get("agent") ?? "";
  const currentProfile = searchParams.get("profile") ?? "";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all-agents" || value === "all-profiles" || (key === "range" && value === "7")) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {/* Agent filter */}
      <Select
        value={currentAgent || "all-agents"}
        onValueChange={(v) => setParam("agent", v)}
      >
        <SelectTrigger className="hidden h-8 w-[140px] text-xs md:flex">
          <SelectValue placeholder="All Agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-agents">All Agents</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Profile filter */}
      <Select
        value={currentProfile || "all-profiles"}
        onValueChange={(v) => setParam("profile", v)}
      >
        <SelectTrigger className="hidden h-8 w-[140px] text-xs md:flex">
          <SelectValue placeholder="All Profiles" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all-profiles">All Profiles</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.profile_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date range */}
      <Select
        value={currentRange}
        onValueChange={(v) => setParam("range", v)}
      >
        <SelectTrigger className="hidden h-8 w-[120px] text-xs md:flex">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {dateRanges.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="hidden h-6 md:block" />

      {/* Export */}
      <Button variant="ghost" size="icon" asChild className="hidden md:flex">
        <a href="/api/jobs/export" title="Export CSV">
          <Download className="h-4 w-4" />
        </a>
      </Button>

      {/* Theme toggle */}
      <ThemeToggle />

      {user && (
        <>
          <Separator orientation="vertical" className="h-6" />
          {user.image && (
            <img
              src={user.image}
              alt=""
              width={28}
              height={28}
              className="rounded-full"
            />
          )}
          <span className="hidden text-xs font-medium md:inline">
            {user.name}
          </span>
          {signOutAction && (
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
