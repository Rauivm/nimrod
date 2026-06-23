-- 015_add_character_to_posts.sql

BEGIN;

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS character_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_posts_character'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT fk_posts_character
      FOREIGN KEY (character_id)
      REFERENCES player_characters(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_character_id
ON posts(character_id);

CREATE INDEX IF NOT EXISTS idx_posts_author_character
ON posts(author_id, character_id);

COMMIT;