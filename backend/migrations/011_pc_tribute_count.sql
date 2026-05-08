-- Migration 011: tribute tracking on player_characters (cemetery integration)

ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS tribute_count INT NOT NULL DEFAULT 0;

-- character_tributes table already handles (character_id, user_id) pairs via
-- the legacy cemetery system. player_character IDs are UUIDs, same as
-- characters.id, so the FK constraint must be dropped or made flexible.
-- We use a trigger-less approach: tribute_count is updated directly by the API.
