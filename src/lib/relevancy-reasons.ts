// Canonical N/A rejection-reason vocabulary — the labels the relevancy classifier
// emits AND the Task Board's `_reason` custom field stores. SINGLE SOURCE OF TRUTH,
// imported by:
//   - the card reason dropdown        (components/tasks/task-full-view.tsx)
//   - the board reason filter          (components/tasks/custom-field-filter.tsx)
//   - the AI Relevancy feedback checklist (components/tasks/relevancy-feedback-form.tsx)
//
// The feedback checklist writes these EXACT strings back into `_reason`, so the
// spelling MUST match the card field's options verbatim (a mismatch would create a
// value the multi-select can't render). Keep in lockstep with PRD §6.2 + Appendix C,
// docs/relevancy/mode_a_prompt.md, migration 020, and the n8n classifier prompt
// (see the sync gotcha in docs/claude/task-board.md). Order is preserved from the
// original card dropdown so existing UIs are unchanged.
export const RELEVANCY_REASON_OPTIONS = [
  "Old job",
  "Duplicate",
  "Location loc",
  "Low Higher rate",
  "Language barrier",
  "Too many invites",
  "Video Proposal",
  "Client suspended",
  "Portfolio unavailable",
  "Client Low spending",
  "Bad rating client",
  "Job unavailable",
  "Already hired",
  "Out of stack",
  "Client already conducting an interview",
  "Short term job checks",
  "Red flag",
] as const;

export type RelevancyReason = (typeof RELEVANCY_REASON_OPTIONS)[number];

// Membership test used server-side to filter agent-ticked values down to real
// reason labels before mirroring them into `_reason` (drops the `__decision__`
// sentinel and anything unexpected).
export const RELEVANCY_REASON_SET: ReadonlySet<string> = new Set(RELEVANCY_REASON_OPTIONS);
