"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Copy, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProposalBoxProps {
  proposal: string | null;
  onChange?: (text: string) => void;
  readOnly?: boolean;
}

export function ProposalBox({ proposal, onChange, readOnly = true }: ProposalBoxProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!proposal) return;
    navigator.clipboard.writeText(proposal).then(() => {
      setCopied(true);
      toast.success("Proposal copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!proposal && readOnly) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FileText className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No proposal</p>
        <p className="text-xs mt-1">AI-generated proposal will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header + Copy Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Proposal</h3>
        {proposal && (
          <Button
            size="sm"
            variant="outline"
            className={cn("h-7 text-xs gap-1.5", copied && "text-green-600 border-green-600/30")}
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy Proposal
              </>
            )}
          </Button>
        )}
      </div>

      {/* Proposal Content */}
      {readOnly ? (
        <div className="rounded-lg border bg-muted/20 p-4 max-h-[calc(100vh-280px)] overflow-y-auto">
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap leading-relaxed text-sm">
            {proposal}
          </div>
        </div>
      ) : (
        <textarea
          value={proposal ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="Write or paste proposal text..."
          className="flex min-h-[400px] w-full rounded-lg border border-input bg-transparent px-4 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y leading-relaxed"
        />
      )}

      {/* Word/char count */}
      {proposal && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{proposal.split(/\s+/).filter(Boolean).length} words</span>
          <span>{proposal.length} characters</span>
        </div>
      )}
    </div>
  );
}
