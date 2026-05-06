-- Migration 008: post threading + entity-linked shares + display_name fallback list

-- Thread support: self-referential parent
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS depth     INT NOT NULL DEFAULT 0;

-- Entity links (share mission/poll/notice to tavern)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS ref_kind TEXT CHECK (ref_kind IN ('mission','poll','notice')),
  ADD COLUMN IF NOT EXISTS ref_id   UUID;

-- Index for reply fetches
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
CREATE INDEX IF NOT EXISTS idx_posts_ref    ON posts(ref_kind, ref_id);

-- Ensure display_name is nullable (idempotent with 007)
ALTER TABLE users ALTER COLUMN display_name DROP NOT NULL;
