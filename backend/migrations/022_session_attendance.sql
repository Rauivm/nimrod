-- 022_session_attendance.sql
--
-- Presence tracking for Nimrod <-> Foundry session launches.
-- Resource changes continue to live in resource_deltas; this table records
-- who entered/left a linked mission session and which character was used.

BEGIN;

CREATE TABLE IF NOT EXISTS session_attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES session_logs(id) ON DELETE RESTRICT,
  mission_id    UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  character_id  UUID REFERENCES player_characters(id) ON DELETE SET NULL,
  actor_name    TEXT,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at       TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sa_session_id
  ON session_attendance (session_id);
CREATE INDEX IF NOT EXISTS idx_sa_mission_id
  ON session_attendance (mission_id);
CREATE INDEX IF NOT EXISTS idx_sa_user_id
  ON session_attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_sa_character_id
  ON session_attendance (character_id);
CREATE INDEX IF NOT EXISTS idx_sa_active
  ON session_attendance (session_id, user_id)
  WHERE left_at IS NULL;

COMMIT;
