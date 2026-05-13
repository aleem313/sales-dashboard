-- Rollback for migration 021. Drops the three added columns + 2 indexes and
-- restores the original NOT NULL constraints on task_id + agent_action.
--
-- DANGER: if any rows have override_type='admin_audit' (which means task_id
-- and/or agent_action are NULL), restoring NOT NULL will fail. The rollback
-- script deletes admin_audit rows first to keep the schema restorable.

DROP INDEX IF EXISTS idx_overrides_admin;
DROP INDEX IF EXISTS idx_overrides_type;

-- Purge admin-audit rows (irreversible; preserves agent_move rows).
DELETE FROM relevancy_overrides WHERE override_type = 'admin_audit';

ALTER TABLE relevancy_overrides DROP COLUMN IF EXISTS note;
ALTER TABLE relevancy_overrides DROP COLUMN IF EXISTS admin_id;
ALTER TABLE relevancy_overrides DROP COLUMN IF EXISTS override_type;

-- Restore NOT NULL. Will fail if any agent_move rows somehow have NULL — should
-- not be possible since the original schema required NOT NULL.
ALTER TABLE relevancy_overrides ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE relevancy_overrides ALTER COLUMN agent_action SET NOT NULL;
