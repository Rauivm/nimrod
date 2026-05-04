-- Migration 003: mission kind (MISSION/NOTICE), reactions, poll on notice
-- All statements are idempotent

-- =========================================
-- ENUM: mission_kind
-- =========================================
DO $$ BEGIN
  CREATE TYPE mission_kind AS ENUM ('MISSION', 'NOTICE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================
-- KIND COLUMN
-- =========================================
ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS kind mission_kind NOT NULL DEFAULT 'MISSION';

-- =========================================
-- DATETIME FIX (CRÍTICO)
-- NOTICE não exige datetime
-- =========================================
ALTER TABLE missions
  ALTER COLUMN datetime DROP NOT NULL;

-- =========================================
-- CHECK CONSISTENCY (MISSION vs NOTICE)
-- =========================================
DO $$ BEGIN
  ALTER TABLE missions
  ADD CONSTRAINT mission_datetime_check
  CHECK (
    (kind = 'MISSION' AND datetime IS NOT NULL)
    OR
    (kind = 'NOTICE')
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================
-- POLL SUPPORT (NOTICE)
-- =========================================
ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS poll_id UUID REFERENCES polls(id) ON DELETE SET NULL;

-- =========================================
-- REACTIONS
-- =========================================
CREATE TABLE IF NOT EXISTS mission_reactions (
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (mission_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_mission_reactions_mission
  ON mission_reactions(mission_id);