-- Migration 010: extend player_characters for cemetery integration

-- Dead status + reason fields on player_characters
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS dead            BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dead_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retire_reason   TEXT,    -- cause of death / retirement story
  ADD COLUMN IF NOT EXISTS classe          TEXT,    -- character class (from Foundry)
  ADD COLUMN IF NOT EXISTS race            TEXT,    -- character race (from Foundry)
  ADD COLUMN IF NOT EXISTS origin          TEXT     NOT NULL DEFAULT 'manual'; -- 'foundry' | 'manual'

-- image_url already exists in the original characters table (cemetery) via migration 002
-- Nothing else needed there.

-- Index for dead/retired characters used in cemetery queries
CREATE INDEX IF NOT EXISTS idx_player_chars_dead    ON player_characters(dead);
CREATE INDEX IF NOT EXISTS idx_player_chars_retired ON player_characters(retired);
