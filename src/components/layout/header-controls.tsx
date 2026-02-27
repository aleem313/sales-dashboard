"use client";

import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Users, Briefcase, Calendar, LogOut } from "lucide-react";
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

function getParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export function HeaderControls({
  agents,
  profiles,
  user,
  signOutAction,
}: HeaderControlsProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const currentRange = mounted ? (getParam("range") || "7") : "7";
  const currentAgent = mounted ? getParam("agent") : "";
  const currentProfile = mounted ? getParam("profile") : "";

  function setParam(key: string, value: string) {
    const url = new URL(window.location.href);
    if (!value || (key === "range" && value === "7")) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
    window.location.assign(url.toString());
  }

  return (
    <div className="hidden items-center gap-2 md:flex">
      {/* Agent filter */}
      <div className="relative inline-flex items-center">
        <Users className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={currentAgent}
          onChange={(e) => setParam("agent", e.target.value)}
          className={
            currentAgent
              ? "appearance-none cursor-pointer rounded-[7px] border border-border bg-[var(--accent-light)] py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-[var(--primary)] transition-all hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none min-w-[130px]"
              : "appearance-none cursor-pointer rounded-[7px] border border-border bg-transparent py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none min-w-[130px]"
          }
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">
          ▾
        </span>
      </div>

      {/* Profile filter */}
      <div className="relative inline-flex items-center">
        <Briefcase className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={currentProfile}
          onChange={(e) => setParam("profile", e.target.value)}
          className={
            currentProfile
              ? "appearance-none cursor-pointer rounded-[7px] border border-border bg-[var(--accent-light)] py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-[var(--primary)] transition-all hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none min-w-[130px]"
              : "appearance-none cursor-pointer rounded-[7px] border border-border bg-transparent py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none min-w-[130px]"
          }
        >
          <option value="">All Profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.profile_name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">
          ▾
        </span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      {/* Date range */}
      <div className="relative inline-flex items-center">
        <Calendar className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={currentRange}
          onChange={(e) => setParam("range", e.target.value)}
          className={
            currentRange !== "7"
              ? "appearance-none cursor-pointer rounded-[7px] border border-border bg-[var(--accent-light)] py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-[var(--primary)] transition-all hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none min-w-[120px]"
              : "appearance-none cursor-pointer rounded-[7px] border border-border bg-transparent py-1.5 pr-7 pl-8 text-[12.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none min-w-[120px]"
          }
        >
          {dateRanges.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[10px] text-muted-foreground">
          ▾
        </span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      {/* Theme toggle */}
      <ThemeToggle />

      {user && (
        <>
          <Separator orientation="vertical" className="h-5" />
          {user.image && (
            <img
              src={user.image}
              alt=""
              width={28}
              height={28}
              className="rounded-full"
            />
          )}
          <span className="text-xs font-medium">
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
