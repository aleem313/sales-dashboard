"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markProposalSentAction } from "@/lib/actions";
import { toast } from "sonner";

export function MarkAsSentButton({
  jobId,
  clickupTaskId,
}: {
  jobId: string;
  clickupTaskId: string | null;
}) {
  const [sending, setSending] = useState(false);

  async function handleClick() {
    setSending(true);
    try {
      await markProposalSentAction(jobId, clickupTaskId);
      toast.success("Marked as sent");
    } catch {
      toast.error("Failed to mark as sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={sending}
      className="gap-1"
    >
      <Send className="h-3 w-3" />
      {sending ? "..." : "Sent"}
    </Button>
  );
}
