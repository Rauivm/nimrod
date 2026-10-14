BEGIN;
ALTER TABLE mana_launch_tickets ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE mana_launch_tickets
  ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES player_characters(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'activity',
  ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS identity_snapshot JSONB;
ALTER TABLE mana_launch_tickets ADD CONSTRAINT mana_ticket_scope CHECK (
  (scope = 'activity' AND participant_id IS NOT NULL) OR
  (scope = 'lobby' AND participant_id IS NULL AND character_id IS NOT NULL AND session_expires_at IS NOT NULL)
);
COMMIT;
