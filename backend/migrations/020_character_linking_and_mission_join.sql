-- 019_character_linking_and_mission_join.sql
--
-- 1. Stores Foundry ownership data per character so players can self-link
--    characters that belong to them in Foundry.
-- 2. Adds character_id to mission_participants so joining with a character is tracked.

BEGIN;

-- Foundry permission owners — array of Foundry actor _id strings
-- populated during sync from actor.ownership (Foundry v10+) or actor.permission (v9).
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS foundry_owner_ids TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_pc_foundry_owner_ids
  ON player_characters USING GIN (foundry_owner_ids);

-- Track which character a player used when joining a mission
ALTER TABLE mission_participants
  ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES player_characters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mp_character_id
  ON mission_participants(character_id);

COMMIT;
