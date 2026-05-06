-- Migration 008: threaded replies + entity-linked posts (idempotent)

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS parent_id   UUID REFERENCES posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS entity_type TEXT CHECK (entity_type IN ('mission', 'poll')),
  ADD COLUMN IF NOT EXISTS entity_id   UUID;

CREATE INDEX IF NOT EXISTS idx_posts_parent_id ON posts(parent_id);
CREATE INDEX IF NOT EXISTS idx_posts_entity    ON posts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
