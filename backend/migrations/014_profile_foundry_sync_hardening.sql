-- Migration 014: harden profile + Foundry sync compatibility.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS player_characters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  foundry_actor_id TEXT UNIQUE,
  name             TEXT NOT NULL,
  level            INT NOT NULL DEFAULT 1,
  xp               INT NOT NULL DEFAULT 0,
  xp_next          INT NOT NULL DEFAULT 300,
  token_img        TEXT,
  portrait_img     TEXT,
  biography        TEXT,
  system           TEXT NOT NULL DEFAULT 'dnd5e',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  retired          BOOLEAN NOT NULL DEFAULT FALSE,
  retired_at       TIMESTAMPTZ,
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS xp_next INT NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS biography TEXT,
  ADD COLUMN IF NOT EXISTS system TEXT NOT NULL DEFAULT 'dnd5e',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS dead BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dead_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retire_reason TEXT,
  ADD COLUMN IF NOT EXISTS classe TEXT,
  ADD COLUMN IF NOT EXISTS race TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'foundry';

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_chars_foundry_unique
  ON player_characters(foundry_actor_id)
  WHERE foundry_actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_player_chars_user_active
  ON player_characters(user_id, active DESC, updated_at DESC);
