-- Migration 005: Foundry VTT user mapping
-- Maps Nimrod users to Foundry roles, worlds and characters
-- No passwords. No Foundry DB access. Pure lookup table.

CREATE TABLE IF NOT EXISTS user_foundry_map (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL CHECK (role IN ('GM', 'PLAYER')),
  world       TEXT NOT NULL,
  actor_name  TEXT  -- nullable: GMs typically have no character
);

CREATE INDEX IF NOT EXISTS idx_user_foundry_map_role ON user_foundry_map(role);

-- Seed examples (remove or replace in production)
-- INSERT INTO user_foundry_map (email, role, world, actor_name)
-- VALUES
--   ('gm@example.com',      'GM',     'forgotten-realms', NULL),
--   ('player1@example.com', 'PLAYER', 'forgotten-realms', 'Aldric Stormhand'),
--   ('player2@example.com', 'PLAYER', 'forgotten-realms', 'Lyria Dawnwhisper')
-- ON CONFLICT (email) DO NOTHING;
