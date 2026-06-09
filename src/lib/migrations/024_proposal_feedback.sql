-- Migration 024: proposal_feedback — agent feedback on AI-written proposals +
-- regeneration history + future-training corpus.
--
-- Background: the n8n proposal writer (Claude Haiku 4.5 in EWnZg3svZWwcIRs4)
-- drafts a proposal once and stamps it onto the Task Board card as
-- custom_fields._proposal. Until now agents could only hand-edit the text — no
-- structured "this proposal is wrong because X", no way to ask the AI for an
-- improved version, nothing captured for model training.
--
-- This table is an APPEND-ONLY log. One row per feedback submission and one row
-- per regeneration attempt, so each row is a self-contained training record:
--   input  = original_proposal + categories + note
--   target = regenerated_proposal (NULL for feedback-only rows)
-- "Keep full history" — every version is retained; the card's _proposal holds
-- only the currently-applied text, the table holds the lineage.
--
-- Mirrors the conventions of relevancy_overrides (migration 018/021/023): TEXT[]
-- for the canonical category labels, TEXT note for free-text, author attributed
-- via agent_id (FK) OR admin_id (NextAuth session id, no FK — admins aren't in
-- the agents table).
--
-- Idempotent — CREATE TABLE / CREATE INDEX use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS proposal_feedback (
  id                   BIGSERIAL PRIMARY KEY,
  task_id              UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  job_external_id      TEXT,                         -- denormalized (_job_id) for training-export joins
  profile_id           TEXT REFERENCES profiles(profile_id),
  agent_id             UUID REFERENCES agents(id),   -- NULL for admins without an agent row
  admin_id             TEXT,                         -- NextAuth session.user.id when admin-authored
  author_role          TEXT NOT NULL CHECK (author_role IN ('agent','admin')),
  categories           TEXT[] NOT NULL DEFAULT '{}', -- canonical proposal-problem labels
  note                 TEXT,                         -- free-text "why wrong" (≤2000 chars, capped app-side)
  original_proposal    TEXT,                         -- proposal text at feedback time (training input)
  regenerated_proposal TEXT,                         -- AI improved text (training target); NULL = feedback-only
  model                TEXT,                         -- model that produced regenerated_proposal
  status               TEXT NOT NULL DEFAULT 'feedback'
                         CHECK (status IN ('feedback','regenerated','regen_failed')),
  applied              BOOLEAN NOT NULL DEFAULT FALSE, -- was regenerated text written back to the card
  request_id           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pf_task    ON proposal_feedback (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pf_profile ON proposal_feedback (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pf_status  ON proposal_feedback (status, created_at DESC);
-- Powers checkProposalRegenRateLimit (count regenerations per author / window).
CREATE INDEX IF NOT EXISTS idx_pf_regen   ON proposal_feedback (created_at DESC) WHERE status = 'regenerated';

-- Housekeeping consistent with prior migrations.
DELETE FROM stats_cache;
