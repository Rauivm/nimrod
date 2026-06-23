-- 018_patch_notes_content_and_fk.sql
--
-- Objetivos:
--   1. Corrigir a FK author_id: ON DELETE SET NULL → ON DELETE RESTRICT
--      (author_id é NOT NULL, portanto SET NULL nunca poderia funcionar)
--   2. Evoluir content JSONB → JSONB NOT NULL DEFAULT '{"sections":[]}'
--   3. Criar índice GIN em content para buscas eficientes no JSONB
--
-- Idempotência:
--   • DROP CONSTRAINT usa IF EXISTS
--   • ADD CONSTRAINT verifica pg_constraint antes de executar
--   • UPDATE só toca linhas onde content IS NULL
--   • CREATE INDEX usa IF NOT EXISTS
--   • ALTER COLUMN SET DEFAULT / SET NOT NULL são seguros em qualquer ordem

BEGIN;

-- ── 1. Corrigir a foreign key de author_id ────────────────────────────────────
--
-- O nome da FK gerada inline em CREATE TABLE pelo PostgreSQL segue o padrão:
--   {tabela}_{coluna}_fkey
-- → patch_notes_author_id_fkey
--
-- Removemos a FK errada (ON DELETE SET NULL) e recriamos com ON DELETE RESTRICT.
-- ON DELETE RESTRICT impede a exclusão de um usuário enquanto ele possuir
-- patch notes — que é o comportamento correto dado que author_id é NOT NULL.

ALTER TABLE patch_notes
  DROP CONSTRAINT IF EXISTS patch_notes_author_id_fkey;

-- Recria somente se ainda não existir (idempotência em re-execuções)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname   = 'fk_patch_notes_author'
      AND  conrelid  = 'patch_notes'::regclass
  ) THEN
    ALTER TABLE patch_notes
      ADD CONSTRAINT fk_patch_notes_author
      FOREIGN KEY (author_id)
      REFERENCES users(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── 2. Evoluir a coluna content ───────────────────────────────────────────────
--
-- Passo 2a: preenche registros existentes que têm content NULL
--           para que o SET NOT NULL seguinte não falhe.
UPDATE patch_notes
SET    content = '{"sections":[]}'::jsonb
WHERE  content IS NULL;

-- Passo 2b: define o DEFAULT para inserções futuras sem content explícito
ALTER TABLE patch_notes
  ALTER COLUMN content SET DEFAULT '{"sections":[]}'::jsonb;

-- Passo 2c: torna a coluna obrigatória
--           (seguro aqui pois o UPDATE acima garantiu que não há NULLs)
ALTER TABLE patch_notes
  ALTER COLUMN content SET NOT NULL;

-- ── 3. Índice GIN para consultas JSONB ───────────────────────────────────────
--
-- Permite queries como:
--   WHERE content @> '{"sections":[{"title":"Classes"}]}'
--   WHERE content ? 'sections'
-- Útil para buscas futuras de patch notes por seção ou tipo de entry.

CREATE INDEX IF NOT EXISTS idx_patch_notes_content
  ON patch_notes
  USING GIN(content);

COMMIT;
