-- Migration 009: player characters (Foundry sync) + user avatars

-- Allow users to have a profile avatar
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Tracks Foundry actors linked to Nimrod users.
-- Populated by the sync job that reads Foundry's actors.db (read-only).
-- The GM can also create/link characters manually.
CREATE TABLE IF NOT EXISTS player_characters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  foundry_actor_id TEXT,                          -- Foundry internal _id
  name             TEXT NOT NULL,
  level            INT  NOT NULL DEFAULT 1,
  xp               INT  NOT NULL DEFAULT 0,
  xp_next          INT  NOT NULL DEFAULT 300,     -- XP needed for next level
  token_img        TEXT,                          -- path inside Foundry data
  portrait_img     TEXT,
  biography        TEXT,
  system           TEXT NOT NULL DEFAULT 'dnd5e', -- game system slug
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  retired          BOOLEAN NOT NULL DEFAULT FALSE,
  retired_at       TIMESTAMPTZ,
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (foundry_actor_id)                       -- prevent duplicate imports
);

-- How many missions each character participated in
-- (derived at query time from mission_participants, no extra table needed)

-- Indexes
CREATE INDEX IF NOT EXISTS idx_player_chars_user_id   ON player_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_player_chars_active     ON player_characters(active);
CREATE INDEX IF NOT EXISTS idx_player_chars_foundry_id ON player_characters(foundry_actor_id);
