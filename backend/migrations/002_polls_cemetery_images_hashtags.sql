-- Migration 002: polls, cemetery images, hashtags, mission level
-- Idempotent: all statements use IF NOT EXISTS / DO NOTHING guards

-- Mission level (adventure level indicator)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS level TEXT;

-- Polls
CREATE TABLE IF NOT EXISTS polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  vote_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, poll_id)
);

-- Cemetery images
ALTER TABLE characters ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Hashtags (persisted counts for trending)
CREATE TABLE IF NOT EXISTS hashtags (
  tag TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_polls_created_at ON polls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON poll_options(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_hashtags_count ON hashtags(count DESC);
