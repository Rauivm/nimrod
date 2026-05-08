CREATE TABLE IF NOT EXISTS player_character_tributes (
  player_character_id UUID NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_character_id, user_id)
);

ALTER TABLE player_characters
ADD COLUMN IF NOT EXISTS tribute_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE player_characters
ADD COLUMN IF NOT EXISTS last_tribute_at TIMESTAMP;