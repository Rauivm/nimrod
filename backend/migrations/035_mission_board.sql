BEGIN;
ALTER TABLE missions DROP CONSTRAINT IF EXISTS mission_datetime_check;
ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS gm_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS min_players INTEGER,
  ADD COLUMN IF NOT EXISTS min_level INTEGER,
  ADD COLUMN IF NOT EXISTS max_level INTEGER,
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS registrations_open BOOLEAN,
  ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
UPDATE missions SET registrations_open = (status = 'OPEN') WHERE registrations_open IS NULL;
ALTER TABLE missions ALTER COLUMN registrations_open SET NOT NULL;
ALTER TABLE missions ALTER COLUMN registrations_open SET DEFAULT TRUE;
UPDATE session_logs sl SET mission_id=ma.mission_id
  FROM mission_arcs ma WHERE sl.arc_id=ma.id AND sl.mission_id IS NULL;
UPDATE missions m SET started_at=(
  SELECT MIN(sl.started_at) FROM session_logs sl WHERE sl.mission_id=m.id
) WHERE m.started_at IS NULL;
-- Infer only from an existing recorded narrator, never from mission creator.
UPDATE missions m SET gm_id = (
  SELECT sl.primary_gm_id FROM session_logs sl
  WHERE sl.mission_id = m.id AND sl.deleted_at IS NULL
  ORDER BY sl.started_at DESC LIMIT 1
) WHERE gm_id IS NULL;
DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mission_player_range' AND conrelid='missions'::regclass) THEN
ALTER TABLE missions ADD CONSTRAINT mission_player_range
  CHECK (max_players > 0 AND max_reserves >= 0 AND
    (min_players IS NULL OR (min_players > 0 AND min_players <= max_players))) NOT VALID;
END IF;
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mission_level_range' AND conrelid='missions'::regclass) THEN
ALTER TABLE missions ADD CONSTRAINT mission_level_range
  CHECK ((min_level IS NULL OR min_level > 0) AND
    (max_level IS NULL OR (min_level IS NOT NULL AND max_level >= min_level))) NOT VALID;
END IF;
END $$;
ALTER TABLE mission_participants
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'APPROVED'
    CHECK (approval_status IN ('PENDING','APPROVED')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
UPDATE mission_participants SET approved_at = joined_at WHERE approved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_fifo ON mission_participants(mission_id, approved_at, joined_at, id)
  WHERE approval_status = 'APPROVED';

-- Refuse ambiguous legacy data rather than delete or silently close sessions.
DO $$ BEGIN
  IF EXISTS (SELECT mission_id FROM session_logs
    WHERE mission_id IS NOT NULL AND status = 'open' AND deleted_at IS NULL
    GROUP BY mission_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Multiple open sessions for a mission; reconcile explicitly before migration 035';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_open_session ON session_logs(mission_id)
  WHERE mission_id IS NOT NULL AND status = 'open' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mission_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mission_gm_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('INVITE','APPLICATION')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_mission_gm ON mission_gm_requests(mission_id,user_id,kind)
  WHERE status = 'PENDING';
CREATE TABLE IF NOT EXISTS mission_vacancy_alerts (
  mission_id UUID NOT NULL REFERENCES missions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(mission_id,user_id)
);
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  mission_id UUID REFERENCES missions(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  email_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED','UNAVAILABLE')),
  email_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id,created_at DESC);
ALTER TABLE session_attendance
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmation_source TEXT;
-- Stable Foundry account identity established with an authenticated one-time proof.
CREATE TABLE IF NOT EXISTS foundry_user_links (
  world_id TEXT NOT NULL,
  foundry_user_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(world_id,foundry_user_id),
  UNIQUE(world_id,user_id)
);
CREATE TABLE IF NOT EXISTS foundry_identity_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_hash TEXT NOT NULL,
  world_id TEXT NOT NULL,
  foundry_user_id TEXT NOT NULL,
  requested_gm BOOLEAN NOT NULL DEFAULT FALSE,
  approved_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  consumed_at TIMESTAMPTZ
);
COMMIT;
