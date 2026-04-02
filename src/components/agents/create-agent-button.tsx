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
import { createAgentAction } from "@/lib/actions";
import { toast } from "sonner";
import { Plus, Copy, Check, KeyRound } from "lucide-react";

interface Credentials {
  email: string;
  password: string;
}

export function CreateAgentButton() {
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  return (
    <>
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
              <Label htmlFor="create-agent-name">Agent Name</Label>
              <Input id="create-agent-name" name="name" placeholder="e.g. John Doe" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-agent-email">Email</Label>
              <Input
                id="create-agent-email"
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
    </>
  );
}
