"use client";

import { useState } from "react";
import { cn, copyText } from "@/lib/utils";
import { toast } from "sonner";
import { Copy, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProposalBoxProps {
  proposal: string | null;
  onChange?: (text: string) => void;
  readOnly?: boolean;
}

/** Format proposal text with ClickUp-style section rendering */
function FormatProposal({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Hook headers: --- Hook A ---, --- Hook B ---
    if (/^-{2,}\s*.+\s*-{2,}$/.test(trimmed)) {
      const hookTitle = trimmed.replace(/^-+\s*/, "").replace(/\s*-+$/, "");
      elements.push(
        <div key={i} className="mt-4 mb-2 first:mt-0">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider px-1">{hookTitle}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>
      );
      continue;
    }

    // Section headers: ALL CAPS lines or lines ending with :
    if (/^[A-Z][A-Z\s]{3,}:?$/.test(trimmed) && trimmed.length < 60) {
      elements.push(
        <div key={i} className="mt-4 mb-1 first:mt-0">
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">{trimmed}</p>
        </div>
      );
      continue;
    }

    // Bullet points
    if (/^[-•]\s/.test(trimmed)) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="text-primary shrink-0 mt-0.5">&#8226;</span>
          <span className="text-sm leading-relaxed">{trimmed.replace(/^[-•]\s*/, "")}</span>
        </div>
      );
      continue;
    }

    // Emphasis lines (BUT..., P.S:, etc.)
    if (/^(BUT|P\.S|NOTE|IMPORTANT)/i.test(trimmed)) {
      elements.push(
        <p key={i} className="text-sm leading-relaxed py-1 font-semibold">{line}</p>
      );
      continue;
    }

    // Empty lines → spacing
    if (trimmed === "") {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Regular text
    elements.push(
      <p key={i} className="text-sm leading-relaxed">{line}</p>
    );
  }

  return <>{elements}</>;
}

export function ProposalBox({ proposal, onChange, readOnly = true }: ProposalBoxProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!proposal) return;
    copyText(proposal).then((ok) => {
      if (ok) {
        setCopied(true);
        toast.success("Proposal copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      } else {
        toast.error("Copy failed");
      }
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
          <FormatProposal text={proposal ?? ""} />
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
