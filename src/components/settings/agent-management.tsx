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
import { toggleAgentActiveAction, createAgentAction } from "@/lib/actions";
import { toast } from "sonner";
import { Plus, Copy, Check, KeyRound } from "lucide-react";
import type { Agent, Profile } from "@/lib/types";

interface Credentials {
  email: string;
  password: string;
}

export function AgentManagement({
  agents,
  profiles,
}: {
  agents: Agent[];
  profiles: Profile[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

    if (!name || !email) {
      toast.error("Name and email are required");
      return;
    }

    setCreating(true);
    try {
      const result = await createAgentAction({ name, email });
      setCredentials(result.credentials);
      setCreateOpen(false);
      setCredentialsOpen(true);
      toast.success("Agent created successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create agent";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function copyToClipboard(text: string, field: string) {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field} copied to clipboard`);
    setTimeout(() => setCopiedField(null), 2000);
  }

  // Get assigned profiles for each agent
  function getAgentProfiles(agentId: string) {
    return profiles.filter((p) => p.agent_id === agentId);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">Agent Management</CardTitle>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-1 h-4 w-4" /> Create Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Agent</DialogTitle>
              <DialogDescription>
                Login credentials will be auto-generated and shown once after creation.
              </DialogDescription>
            </DialogHeader>
            <form action={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent Name</Label>
                <Input id="agent-name" name="name" placeholder="e.g. John Doe" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-email">Email</Label>
                <Input
                  id="agent-email"
                  name="email"
                  type="email"
                  placeholder="e.g. john@company.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "Creating..." : "Create Agent"}
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
                <TableHead className="hidden md:table-cell">Profiles</TableHead>
                <TableHead className="hidden lg:table-cell">Login</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const agentProfiles = getAgentProfiles(agent.id);
                return (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {agent.email ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {agentProfiles.length === 0 ? (
                        <span className="text-muted-foreground text-xs">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {agentProfiles.map((p) => (
                            <Badge key={p.id} variant="secondary" className="text-xs">
                              {p.profile_name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {agent.password_hash ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <KeyRound className="h-3 w-3" /> Enabled
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">No credentials</span>
                      )}
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Credentials Modal — shown once after agent creation */}
      <Dialog open={credentialsOpen} onOpenChange={(open) => {
        if (!open) setCredentials(null);
        setCredentialsOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agent Credentials Created</DialogTitle>
            <DialogDescription>
              Save these credentials now — the password will NOT be shown again.
            </DialogDescription>
          </DialogHeader>
          {credentials && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Email</p>
                    <p className="font-mono text-sm">{credentials.email}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(credentials.email, "Email")}
                  >
                    {copiedField === "Email" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Password</p>
                    <p className="font-mono text-sm">{credentials.password}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(credentials.password, "Password")}
                  >
                    {copiedField === "Password" ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={() =>
                  copyToClipboard(
                    `Email: ${credentials.email}\nPassword: ${credentials.password}`,
                    "All"
                  )
                }
              >
                {copiedField === "All" ? (
                  <><Check className="mr-2 h-4 w-4 text-green-500" /> Copied!</>
                ) : (
                  <><Copy className="mr-2 h-4 w-4" /> Copy All</>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
