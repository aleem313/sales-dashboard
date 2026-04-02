"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProfileAction } from "@/lib/actions";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { Agent } from "@/lib/types";

export function CreateProfileButton({ agents }: { agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

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

  return (
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
            <Label htmlFor="cp-profile-name">Profile Name</Label>
            <Input id="cp-profile-name" name="profile_name" placeholder="e.g. Full Stack Dev" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-profile-id">Unique Identifier</Label>
            <Input
              id="cp-profile-id"
              name="profile_id"
              placeholder="e.g. upwork-fullstack-1 (used in n8n routing)"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-platform">Platform</Label>
            <Select name="platform" defaultValue="Upwork">
              <SelectTrigger id="cp-platform">
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
            <Label htmlFor="cp-stack">Stack</Label>
            <Input id="cp-stack" name="stack" placeholder="e.g. React, Node.js" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-agent">Assigned Agent</Label>
            <Select name="agent_id" defaultValue="none">
              <SelectTrigger id="cp-agent">
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
  );
}
