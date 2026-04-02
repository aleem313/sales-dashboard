"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  toggleProfileActiveAction,
  updateProfileAgentAction,
  createProfileAction,
} from "@/lib/actions";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

export function ProfileManagement({
  profiles,
  agents,
}: {
  profiles: Profile[];
  agents: Agent[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleToggle(id: string, active: boolean) {
    setLoading(id);
    try {
      await toggleProfileActiveAction(id, active);
      toast.success(`Profile ${active ? "activated" : "deactivated"}`);
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setLoading(null);
    }
  }

  async function handleAgentChange(profileId: string, agentId: string) {
    const newAgentId = agentId === "none" ? null : agentId;

    // Warn if profile is being reassigned from another agent
    if (newAgentId) {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile?.agent_id && profile.agent_id !== newAgentId) {
        const prevAgent = agents.find((a) => a.id === profile.agent_id);
        if (
          !confirm(
            `This profile is currently assigned to ${prevAgent?.name ?? "another agent"}. Reassigning will remove it from them. Continue?`
          )
        ) {
          return;
        }
      }
    }

    setLoading(profileId);
    try {
      await updateProfileAgentAction(profileId, newAgentId);
      toast.success("Profile agent updated");
    } catch {
      toast.error("Failed to update agent");
    } finally {
      setLoading(null);
    }
  }

  async function handleCreate(formData: FormData) {
    const profile_id = formData.get("profile_id") as string;
    const profile_name = formData.get("profile_name") as string;
    const platform = formData.get("platform") as string;
    const stack = formData.get("stack") as string;
    const agent_id = formData.get("agent_id") as string;

    if (!profile_id || !profile_name) {
      toast.error("Profile ID and name are required");
      return;
    }

    setCreating(true);
    try {
      await createProfileAction({
        profile_id,
        profile_name,
        platform: platform || "Upwork",
        stack: stack || null,
        agent_id: agent_id && agent_id !== "none" ? agent_id : null,
      });
      toast.success("Profile created");
      setOpen(false);
    } catch {
      toast.error("Failed to create profile");
    } finally {
      setCreating(false);
    }
  }

  function getAgentName(agentId: string | null) {
    if (!agentId) return null;
    return agents.find((a) => a.id === agentId)?.name ?? null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">
          Profile Management
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-1 h-4 w-4" /> Create Profile
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Profile</DialogTitle>
              <DialogDescription>
                Each profile can only be assigned to one agent at a time.
              </DialogDescription>
            </DialogHeader>
            <form action={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Profile Name</Label>
                <Input id="profile-name" name="profile_name" placeholder="e.g. Full Stack Dev" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-id">Unique Identifier</Label>
                <Input
                  id="profile-id"
                  name="profile_id"
                  placeholder="e.g. upwork-fullstack-1 (used in n8n routing)"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-platform">Platform</Label>
                <Select name="platform" defaultValue="Upwork">
                  <SelectTrigger id="profile-platform">
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Upwork">Upwork</SelectItem>
                    <SelectItem value="Freelancer">Freelancer</SelectItem>
                    <SelectItem value="Fiverr">Fiverr</SelectItem>
                    <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-stack">Stack</Label>
                <Input
                  id="profile-stack"
                  name="stack"
                  placeholder="e.g. React, Node.js"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-agent">Assigned Agent</Label>
                <Select name="agent_id" defaultValue="none">
                  <SelectTrigger id="profile-agent">
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "Creating..." : "Create Profile"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No profiles configured.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Platform</TableHead>
                <TableHead className="hidden md:table-cell">Stack</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium">{profile.profile_name}</span>
                      <p className="text-xs text-muted-foreground font-mono">
                        {profile.profile_id}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="text-xs">
                      {profile.platform ?? "Upwork"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {profile.stack ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={profile.agent_id ?? "none"}
                      onValueChange={(val) =>
                        handleAgentChange(profile.id, val)
                      }
                      disabled={loading === profile.id}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={profile.active}
                      disabled={loading === profile.id}
                      onCheckedChange={(checked) =>
                        handleToggle(profile.id, checked)
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
