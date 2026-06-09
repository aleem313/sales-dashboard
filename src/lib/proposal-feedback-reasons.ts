// Canonical "why is this AI proposal wrong" category vocabulary — the labels an
// agent ticks in the Proposal Feedback panel of a task card. SINGLE SOURCE OF
// TRUTH, imported by:
//   - the feedback checklist UI       (components/tasks/proposal-feedback-panel.tsx)
//   - the feedback + regenerate routes (api/tasks/[id]/proposal-feedback, api/proposals/regenerate)
//
// These exact strings are stored in proposal_feedback.categories and forwarded to
// the n8n `proposal-regenerate` webhook so the proposal writer knows what to fix.
// They are ALSO the training-corpus labels — keep them stable. If you add/rename
// a category, treat it like a schema change: the n8n regenerate workflow's prompt
// should reference the same vocabulary.
//
// This is intentionally separate from relevancy-reasons.ts: those are job-level
// N/A reasons (why a JOB is irrelevant); these are proposal-level defects (why the
// WRITTEN PROPOSAL is bad). Different domain, different lifecycle.
export const PROPOSAL_FEEDBACK_OPTIONS = [
  "Weak or generic hook",
  "Hallucinated portfolio/experience",
  "Missed a job requirement",
  "Inaccurate claim about client/job",
  "Wrong tone — not human",
  "Too long",
  "Too short",
  "Broke formatting rules",
  "Irrelevant to the job",
  "Repetitive / filler",
  "Wrong or missing screening answer",
] as const;

export type ProposalFeedbackReason = (typeof PROPOSAL_FEEDBACK_OPTIONS)[number];

// Membership test used server-side to validate agent-submitted categories down to
// real labels before persisting / forwarding to n8n (drops anything unexpected).
export const PROPOSAL_FEEDBACK_SET: ReadonlySet<string> = new Set(PROPOSAL_FEEDBACK_OPTIONS);
