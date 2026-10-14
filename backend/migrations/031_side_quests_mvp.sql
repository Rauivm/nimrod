-- migrations/031_side_quests_mvp.sql
--
-- generic activities and participants tables.
--

BEGIN;

-- ── 1. Create Enums ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE activity_type_enum AS ENUM ('SIDE_QUEST', 'ARENA', 'RESEARCH', 'REST', 'HOSPITAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_status_enum AS ENUM ('WAITING', 'RUNNING', 'FINISHED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE participant_status_enum AS ENUM ('JOINED', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Extend player_characters Table ────────────────────────────────────────
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS gold       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abilities  JSONB NOT NULL DEFAULT '{"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10}'::jsonb,
  ADD COLUMN IF NOT EXISTS resources   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS flags       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version     INT NOT NULL DEFAULT 1;

-- ── 3. Create Activities Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  activity_type activity_type_enum NOT NULL,
  status activity_status_enum NOT NULL DEFAULT 'WAITING',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  goal INT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  max_participants INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  rewards JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  report JSONB DEFAULT NULL,
  report_generated_at TIMESTAMPTZ DEFAULT NULL,
  
  location_id UUID,
  badge_id UUID,
  event_id UUID,
  
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_status_type ON activities(status, activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_dates ON activities(starts_at, ends_at);

-- ── 4. Create Activity Participants Table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status participant_status_enum NOT NULL DEFAULT 'JOINED',
  
  -- Audit details
  dice INT NOT NULL,
  modifier INT NOT NULL,
  total INT NOT NULL,
  
  -- Contribution states
  contribution INT NOT NULL DEFAULT 0,
  contribution_current INT NOT NULL DEFAULT 0,
  
  -- Rewards collection
  reward_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  UNIQUE (activity_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_act_part_char ON activity_participants(character_id);

-- ── 5. Create Activity Audit Logs Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  
  old_state JSONB DEFAULT NULL,
  new_state JSONB DEFAULT NULL,
  
  request_id TEXT,
  correlation_id TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_act_logs_activity ON activity_logs(activity_id);

COMMIT;
