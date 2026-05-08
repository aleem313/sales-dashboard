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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  toggleProfileActiveAction,
  updateProfileAgentAction,
  createProfileAction,
} from "@/lib/actions";
import { toast } from "sonner";
import { Plus, Copy, Check } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";
import { ProfileUpworkSnapshotSheet } from "./profile-upwork-snapshot";

type SnapshotSummary = {
  extractedAt: string;
  name: string | null;
  rating: number | null;
  jobSuccessScore: number | null;
  totalJobsWorked: number | null;
};

const N8N_WEBHOOK_BASE = "https://ikonicdev.app.n8n.cloud/webhook";

function getWebhookUrl(profileName: string) {
  const slug = profileName.toLowerCase().replace(/\s+/g, "-");
  return `${N8N_WEBHOOK_BASE}/${slug}-profile-webhook`;
}

export function ProfileManagement({
  profiles,
  agents,
  snapshotSummaries = {},
  isAdmin = false,
}: {
  profiles: Profile[];
  agents: Agent[];
  snapshotSummaries?: Record<string, SnapshotSummary>;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      const result = await createProfileAction({
        profile_id,
        profile_name,
        platform: platform || "Upwork",
        stack: stack || null,
        agent_id: agent_id && agent_id !== "none" ? agent_id : null,
      });
      toast.success("Profile created");

      // Show n8n sync result
      const sync = result.n8nSync as { success?: boolean; alreadyExists?: boolean; error?: string } | undefined;
      if (sync?.success) {
        toast.success(`n8n webhook created: ${profile_name}`, {
          description: sync.alreadyExists
            ? "Webhook already existed"
            : "Webhook + respond nodes added to workflow",
        });
      } else if (sync?.error) {
        toast.warning("Profile created but n8n sync failed", {
          description: sync.error,
        });
      }

      setOpen(false);
    } catch {
      toast.error("Failed to create profile");
    } finally {
      setCreating(false);
    }
  }

  async function copyWebhookUrl(profileName: string, profileId: string) {
    const url = getWebhookUrl(profileName);
    await navigator.clipboard.writeText(url);
    setCopiedId(profileId);
    toast.success("Webhook URL copied");
    setTimeout(() => setCopiedId(null), 2000);
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
                Each profile can only be assigned to one agent. A webhook node will be auto-created in n8n.
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
                <TableHead className="hidden lg:table-cell">Webhook URL</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Snapshot</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TooltipProvider>
                {profiles.map((profile) => {
                  const webhookUrl = getWebhookUrl(profile.profile_name);
                  return (
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
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <code className="max-w-[280px] truncate text-xs text-muted-foreground block">
                                {webhookUrl}
                              </code>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-md">
                              <p className="font-mono text-xs break-all">{webhookUrl}</p>
                            </TooltipContent>
                          </Tooltip>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 shrink-0"
                            onClick={() => copyWebhookUrl(profile.profile_name, profile.id)}
                          >
                            {copiedId === profile.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
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
                        <div className="flex flex-col items-start gap-1">
                          <ProfileUpworkSnapshotSheet
                            profileUuid={profile.id}
                            profileName={profile.profile_name}
                            hasSnapshot={!!snapshotSummaries[profile.profile_id]}
                            isAdmin={isAdmin}
                          />
                          {snapshotSummaries[profile.profile_id] && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatRelative(snapshotSummaries[profile.profile_id]!.extractedAt)}
                            </span>
                          )}
                        </div>
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
                  );
                })}
              </TooltipProvider>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  return `${Math.floor(diffSec / (86400 * 365))}y ago`;
}
