-- Migration 020: Extend criteria_versions.reason_enum with 3 soft-signal labels.
--
-- Added 2026-05-12. These are SOFT-SIGNAL labels — no new hard gates. The classifier
-- (Mode A prompt on both Gemini + DeepSeek agents in hi71jhPU8tmq7hEp) emits them
-- attached to existing gate contexts so we can observe production volume before
-- deciding whether to formalize as gates 12/13/14.
--
-- New labels (in order):
--   • "Client already conducting an interview" — active interviewing / shortlisting,
--      but position not yet filled. Distinct from "Already hired". Maps under gate 7.
--   • "Short term job checks" — one-off / micro-task / very short gig. Detection:
--      "one-off", "single task", "quick fix", "1-2 hour", or duration <1 week with
--      fixed budget <$200. Maps under gate 4.
--   • "Red flag" — catch-all for scammy/suspicious posting: vague scope, MLM hints,
--      "make $X per day", off-platform contact requests (Telegram/Discord/WhatsApp),
--      excessive emojis, contradictions, suspicious template language. Maps under
--      whichever gate is closest.
--
-- Idempotent — uses an existence guard so re-running this migration is a no-op
-- once the labels are already in the array.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM criteria_versions
    WHERE version = '0.2'
      AND reason_enum @> ARRAY['Client already conducting an interview']::TEXT[]
  ) THEN
    UPDATE criteria_versions
    SET reason_enum = reason_enum || ARRAY[
      'Client already conducting an interview',
      'Short term job checks',
      'Red flag'
    ]::TEXT[]
    WHERE version = '0.2';
  END IF;
END $$;
