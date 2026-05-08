-- Migration 013: cemetery improvements
-- 1. Adiciona image_url em player_characters (para upload manual de imagem)
ALTER TABLE player_characters
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Garante que player_character_tributes tem created_at (pode já existir)
ALTER TABLE player_character_tributes
  ALTER COLUMN created_at SET DEFAULT NOW();

-- 3. Índices de performance para queries de tribute expirado
CREATE INDEX IF NOT EXISTS idx_char_tributes_created
  ON character_tributes(character_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pc_tributes_created
  ON player_character_tributes(player_character_id, created_at);

CREATE INDEX IF NOT EXISTS idx_char_tributes_user_created
  ON character_tributes(character_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pc_tributes_user_created
  ON player_character_tributes(player_character_id, user_id, created_at);
