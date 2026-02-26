"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleAgentActiveAction, createAgentAction } from "@/lib/actions";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { Agent } from "@/lib/types";

export function AgentManagement({ agents }: { agents: Agent[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  async function handleToggle(id: string, active: boolean) {
    setLoading(id);
    try {
      await toggleAgentActiveAction(id, active);
      toast.success(`Agent ${active ? "activated" : "deactivated"}`);
    } catch {
      toast.error("Failed to update agent");
    } finally {
      setLoading(null);
    }
  }

  async function handleCreate(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const clickup_user_id = formData.get("clickup_user_id") as string;

    if (!name || !clickup_user_id) {
      toast.error("Name and ClickUp User ID are required");
      return;
    }

    try {
      await createAgentAction({ name, email: email || null, clickup_user_id });
      toast.success("Agent created");
      setOpen(false);
    } catch {
      toast.error("Failed to create agent");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Agent Management</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-1 h-4 w-4" /> Add Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Agent</DialogTitle>
            </DialogHeader>
            <form action={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input id="agent-name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-email">Email</Label>
                <Input id="agent-email" name="email" type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-clickup-id">ClickUp User ID</Label>
                <Input id="agent-clickup-id" name="clickup_user_id" required />
              </div>
              <Button type="submit" className="w-full">
                Create Agent
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead className="hidden md:table-cell">ClickUp ID</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {agent.email ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground font-mono text-xs">
                    {agent.clickup_user_id}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={agent.active}
                      disabled={loading === agent.id}
                      onCheckedChange={(checked) =>
                        handleToggle(agent.id, checked)
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
