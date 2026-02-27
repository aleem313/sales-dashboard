"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { DateRangePicker } from "@/components/date-range-picker";
import { Users, Briefcase, LogOut } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

interface HeaderControlsProps {
  agents: Agent[];
  profiles: Profile[];
}

export function HeaderControls({ agents, profiles }: HeaderControlsProps) {
  const { data: session } = useSession();
  const [agentValue, setAgentValue] = useState("");
  const [profileValue, setProfileValue] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAgentValue(params.get("agent") || "");
    setProfileValue(params.get("profile") || "");
  }, []);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const key = e.target.name;
    const value = e.target.value;
    const url = new URL(window.location.href);

    if (!value) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }

    window.location.href = url.toString();
  }
  const user = session?.user;

  return (
    <div className="hidden items-center gap-2 md:flex">
      {/* Agent filter */}
      <div className="relative inline-flex items-center">
        <Users className="pointer-events-none absolute left-2.5 z-10 h-3.5 w-3.5 text-muted-foreground" />
        <select
          name="agent"
          value={agentValue}
          onChange={handleSelectChange}
          className="appearance-none cursor-pointer rounded-[7px] border border-border bg-transparent py-1.5 pr-7 pl-8 text-[13.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none min-w-[130px]"
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[12px] text-muted-foreground">
          ▾
        </span>
      </div>

      {/* Profile filter */}
      <div className="relative inline-flex items-center">
        <Briefcase className="pointer-events-none absolute left-2.5 z-10 h-3.5 w-3.5 text-muted-foreground" />
        <select
          name="profile"
          value={profileValue}
          onChange={handleSelectChange}
          className="appearance-none cursor-pointer rounded-[7px] border border-border bg-transparent py-1.5 pr-7 pl-8 text-[13.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none min-w-[130px]"
        >
          <option value="">All Profiles</option>
          {profiles.map((p) => (
            <option key={p.profile_id} value={p.profile_id}>
              {p.profile_name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[12px] text-muted-foreground">
          ▾
        </span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      {/* Date range picker */}
      <DateRangePicker />

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
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
